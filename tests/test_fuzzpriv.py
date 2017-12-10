# coding=utf-8
'''
Test TODO:

- makefile
- fuzzPriv global object not injected for non-local url (how?)
- request to file:#fuzz= gets argument fetched and injected as script
- caching api
- resizeTo
- zoom
- forceGC/GC/CC
- enableAccessibility
'''
import http.server
import logging
import os
import re
import shutil
import socketserver
import tempfile
import threading
import ffpuppet
import pytest


EXT_PATH = os.path.realpath(os.path.dirname(os.path.dirname(__file__)))
PREFS = os.getenv('PREFS', os.path.join(os.path.dirname(__file__), 'prefs.js'))
FIREFOX = os.getenv('FIREFOX', os.path.expanduser('~/builds/asan/firefox'))

log = logging.getLogger('fuzzpriv_test')  # pylint: disable=invalid-name


# set output verbosity
if pytest.config.option.verbose:
    log_level = logging.DEBUG
    log_fmt = "%(levelname).1s %(name)s [%(asctime)s] %(message)s"
else:
    log_level = logging.INFO
    log_fmt = "[%(asctime)s] %(message)s"
logging.basicConfig(format=log_fmt, datefmt="%Y-%m-%d %H:%M:%S", level=log_level)


def run_ffp(binary, prefs, location):
    '''
    Run firefox and return dict of available logs.
    '''
    result = {}
    ffp = ffpuppet.FFPuppet(use_xvfb=True)
    ffp.add_abort_token(re.compile(r'###!!!\s*\[Parent\].+?Error:\s*\(.+?name=PBrowser::Msg_Destroy\)'))

    try:
        ffp.launch(
            binary,
            location=location,
            launch_timeout=300,
            prefs_js=prefs,
            extension=EXT_PATH)
        ffp.check_prefs(prefs)
        log.info('Running Firefox (pid: %d)...', ffp.get_pid())
        assert ffp.wait(timeout=10) is not None
    finally:
        log.info('Shutting down...')
        ffp.close()
        log.info('Firefox process closed')
        try:
            tmpd = tempfile.mkdtemp(prefix='fuzzpriv-test-')
            try:
                ffp.save_logs(tmpd)
                for logfile in os.listdir(tmpd):
                    with open(os.path.join(tmpd, logfile)) as logfp:
                        result[os.path.splitext(logfile)[0]] = logfp.read()
            finally:
                shutil.rmtree(tmpd)
        finally:
            ffp.clean_up()
    return result


def dump_logs(logs):
    for logfile in logs:
        for line in logs[logfile].strip().splitlines():
            log.debug('%s: %s', logfile, line)


def test_fuzzpriv_injected(tmpdir):
    '''
    Check that fuzzPriv is injected in file:// and http://localhost urls.
    '''
    test1 = r'''<script>
    try {
      fuzzPriv.GC()
      dump('test: passed\n')
    } catch (e) {
      dump('test: failed: ' + e + '\n')
    }
    window.close()
    </script>'''
    with open(os.path.join(tmpdir, 'test1.html'), 'w') as testfp:
        testfp.write(test1)
    logs = run_ffp(FIREFOX, PREFS, os.path.join(tmpdir, 'test1.html'))
    dump_logs(logs)
    assert re.search(r'^test: passed$', logs['log_stdout'], re.MULTILINE) is not None
    curd = os.getcwd()
    os.chdir(tmpdir)
    thread = None
    try:
        with socketserver.TCPServer(('', 0), http.server.SimpleHTTPRequestHandler) as httpd:
            log.info('Serving at %s:%d', httpd.server_address[0], httpd.server_address[1])
            thread = threading.Thread(target=httpd.serve_forever)
            thread.start()
            try:
                location = 'http://127.0.0.1:%d/test1.html' % httpd.server_address[1]
                logs = run_ffp(FIREFOX, PREFS, location)
                dump_logs(logs)
                assert re.search(r'^test: passed$', logs['log_stdout'], re.MULTILINE) is not None
                location = 'http://localhost:%d/test1.html' % httpd.server_address[1]
                logs = run_ffp(FIREFOX, PREFS, location)
                dump_logs(logs)
                assert re.search(r'^test: passed$', logs['log_stdout'], re.MULTILINE) is not None
            finally:
                httpd.shutdown()
                httpd.socket.close()
                thread.join()
    finally:
        os.chdir(curd)


def test_grizzly_harness(tmpdir):
    '''
    Check that requests to localhost which look like grizzly use a harness from
    the extension scope.
    '''
    test2a = r'''<script>
    dump('test: failed: this should not have been executed\n')
    window.close()
    </script>'''
    test2b = r'''<script>
    dump('test: passed\n')
    fuzzPriv.quitApplication()
    </script>'''
    test2c = r'''<script>
    dump('test: failed: not expecting next_test to be reached\n')
    fuzzPriv.quitApplication()
    </script>'''
    test2d = r'''<script>
    dump('test: first test\n')
    fuzzPriv.closeTabThenQuit()
    </script>'''
    test2e = r'''<script>
    dump('test: next test\n')
    window.close()
    </script>'''
    test2f = r'''<script>
    dump('test: next test\n')
    </script>'''

    class HtmlRequestHandler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {'': 'text/html'}

    curd = os.getcwd()
    os.chdir(tmpdir)
    thread = None
    try:
        # check that harness is used
        with open(os.path.join(tmpdir, 'harness'), 'w') as testfp:
            testfp.write(test2a)
        with open(os.path.join(tmpdir, 'first_test'), 'w') as testfp:
            testfp.write(test2b)
        with open(os.path.join(tmpdir, 'next_test'), 'w') as testfp:
            testfp.write(test2c)
        with socketserver.TCPServer(('', 0), HtmlRequestHandler) as httpd:
            log.info('Serving at %s:%d', httpd.server_address[0], httpd.server_address[1])
            thread = threading.Thread(target=httpd.serve_forever)
            thread.start()
            try:
                location = 'http://127.0.0.1:%d/harness#10000' % httpd.server_address[1]
                logs = run_ffp(FIREFOX, PREFS, location)
                dump_logs(logs)
                assert re.search(r'^test: passed$', logs['log_stdout'], re.MULTILINE) is not None
                assert re.search(r'^test: failed:', logs['log_stdout'], re.MULTILINE) is None
            finally:
                httpd.shutdown()
                httpd.socket.close()
                thread.join()
        # check that next test is called multiple times
        with open(os.path.join(tmpdir, 'first_test'), 'w') as testfp:
            testfp.write(test2d)
        with open(os.path.join(tmpdir, 'next_test'), 'w') as testfp:
            testfp.write(test2e)
        with socketserver.TCPServer(('', 0), HtmlRequestHandler) as httpd:
            log.info('Serving at %s:%d', httpd.server_address[0], httpd.server_address[1])
            thread = threading.Thread(target=httpd.serve_forever)
            thread.start()
            try:
                location = 'http://127.0.0.1:%d/harness#10000' % httpd.server_address[1]
                logs = run_ffp(FIREFOX, PREFS, location)
                dump_logs(logs)
                assert re.search(r'^test: first test$', logs['log_stdout'], re.MULTILINE) is not None
                assert len(re.findall(r'^test: next test$', logs['log_stdout'], re.MULTILINE)) > 1
            finally:
                httpd.shutdown()
                httpd.socket.close()
                thread.join()
        # check that timeout works
        with open(os.path.join(tmpdir, 'next_test'), 'w') as testfp:
            testfp.write(test2f)
        with socketserver.TCPServer(('', 0), HtmlRequestHandler) as httpd:
            log.info('Serving at %s:%d', httpd.server_address[0], httpd.server_address[1])
            thread = threading.Thread(target=httpd.serve_forever)
            thread.start()
            try:
                location = 'http://127.0.0.1:%d/harness#100' % httpd.server_address[1]
                logs = run_ffp(FIREFOX, PREFS, location)
                dump_logs(logs)
                assert re.search(r'^test: first test$', logs['log_stdout'], re.MULTILINE) is not None
                assert len(re.findall(r'^test: next test$', logs['log_stdout'], re.MULTILINE)) > 1
            finally:
                httpd.shutdown()
                httpd.socket.close()
                thread.join()
    finally:
        os.chdir(curd)


def test_quitApplication(tmpdir):
    test3 = r'''<script>
    try { fuzzPriv.quitApplication() } catch (e) {}
    setTimeout(() => dump('test: failed\n'), 500)
    </script>'''
    with open(os.path.join(tmpdir, 'test3.html'), 'w') as testfp:
        testfp.write(test3)
    logs = run_ffp(FIREFOX, PREFS, os.path.join(tmpdir, 'test3.html'))
    dump_logs(logs)
    assert re.search(r'^test: failed$', logs['log_stdout'], re.MULTILINE) is None


def test_quitApplicationSoon(tmpdir):
    test4 = r'''<script>
    intervals = 0
    try { fuzzPriv.quitApplicationSoon() } catch (e) {}
    setInterval(() => {
      intervals++
      dump('test: ' + intervals + '\n')
    }, 500)
    </script>'''
    with open(os.path.join(tmpdir, 'test4.html'), 'w') as testfp:
        testfp.write(test4)
    logs = run_ffp(FIREFOX, PREFS, os.path.join(tmpdir, 'test4.html'))
    dump_logs(logs)
    matches = list(re.finditer(r'^test: (\d+)$', logs['log_stdout'], re.MULTILINE))
    assert matches, "setInterval should have run"
    assert 7 <= int(matches[-1].group(1)) <= 9  # .5s intervals, should be about 4 seconds give or take

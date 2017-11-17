/*
 * fuzzpriv webextension edition
 *
 * content script
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
'use strict'

/* global browser, cloneInto, FuzzingFunctions, fetch, location, window */

const dump = (window.dump && ((msg) => window.dump(msg + '\n'))) || console.log

let port = browser.runtime.connect()
let cacheRequests = []

let harnessTimeout = (() => {
  if (!location.hash.startsWith('#')) {
    return undefined
  }
  let result = Number(location.hash.slice(1))
  if (isNaN(result)) {
    return undefined
  }
  return result
})()

/*
 * Possibly inject the fuzzer script into the page
 */
if (location.protocol === 'file:' && location.hash.startsWith('#fuzz=')) {
  let fuzzHash = location.hash.slice(6).split(',')
  let fuzzScript = fetch(fuzzHash.pop())
  let fuzzSettings = fuzzHash.map((s) => Number(s))
  fuzzScript.then((fuzzer) => {
    let scriptToInject = (
      fuzzer + '\n' +
      'document.getElementById(\'fuzz1\').parentNode.removeChild(document.getElementById(\'fuzz1\'));\n' +
      'fuzzSettings = [' + fuzzSettings.join(',') + '];\n' +
      'fuzzOnload();\n')

    let insertionPoint = document.getElementsByTagName('head')[0] || document.documentElement
    if (!insertionPoint) {
      console.log('error finding insertion point for fuzzer script')
      return
    }

    let script = document.createElement('script')
    script.setAttribute('id', 'fuzz1')
    script.setAttribute('type', 'text/javascript')
    script.textContent = scriptToInject
    insertionPoint.appendChild(script)
  })
} else if (location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && harnessTimeout !== undefined) {
  document.title = '🐻 ⋅ Grizzly ⋅ 🦊'
  document.body.outerHTML = '<meta charset=UTF-8><style>html{background:black;color:#f0f;}blink{-webkit-animation:2s linear infinite e;animation:2s linear infinite e}@-webkit-keyframes e{0%{visibility:hidden}50%{visibility:hidden}100%{visibility:visible}}@keyframes e{0%{visibility:hidden}50%{visibility:hidden}100%{visibility:visible}}</style><h1>Welcome to Grizzly</h1><blink>fuzzing in progress</blink>'
  port.postMessage({cmd: 'grizzlyHarness', timeout: harnessTimeout, location: 'http://' + location.host})
}

let cc = (() => {
  let warned = false
  return () => {
    if ('FuzzingFunctions' in window) {
      FuzzingFunctions.cycleCollect() // firefox with --enable-fuzzing & fuzzing.enabled=true
    } else if (!warned) {
      dump('No cycle-collection function available.')
      warned = true
    }
  }
})()

let gc = (() => {
  let warned = false
  return () => {
    if ('gc' in window) {
      window.gc() // chromium w/ --js-flags=--expose-gc
    } else if ('FuzzingFunctions' in window) {
      FuzzingFunctions.garbageCollect() // firefox with --enable-fuzzing & fuzzing.enabled=true
    } else if (!warned) {
      dump('No garbage-collection function available.')
      warned = true
    }
  }
})()

function comparePixels () {
  /*
   * NOT WORKING!
   *
   * this will need to use browser.tabs.captureVisibleTab instead of ctx.drawWindow
   */
  let w = window.innerWidth
  let h = window.innerHeight
  dump(w + ' x ' + h)

  let canvas1 = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
  canvas1.setAttribute('width', w)
  canvas1.setAttribute('height', h)
  canvas1.setAttribute('moz-opaque', 'true')

  let canvas2 = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
  canvas2.setAttribute('width', w)
  canvas2.setAttribute('height', h)
  canvas2.setAttribute('moz-opaque', 'true')

  function drawInto (canvas) {
    let ctx = canvas.getContext('2d')
    ctx.drawWindow(window,
                   window.scrollX,
                   window.scrollY,
                   w,
                   h,
                   'rgb(255,255,255)',
                   ctx.DRAWWINDOW_DRAW_CARET |
                   ctx.DRAWWINDOW_USE_WIDGET_LAYERS)
  }

  function compareCanvases (canvas1, canvas2, maxDifference) {
    if (!canvas1 || !canvas2) {
      throw 'expecting 2 canvases';
    }

    let data1 = canvas1.getImageData(0, 0, w, h)
    let data2 = canvas2.getImageData(0, 0, w, h)
    let v
    let stride = data1.data.length / h

    function memcmp(a, b, length, offset) {
      if (length === undefined) {
        length = a.length
      }
      if (offset === undefined) {
        offset = 0
      }
      let t
      for (let i = offset; i < length; ++i) {
        t = b[i] - a[i]
        if (t !== 0) {
          return t
        }
      }
      return 0
    }

    // we can optimize for the common all-pass case
    if (stride === w * 4) {
      v = memcmp(data1.data, data2.data)
      if (v === 0) {
        if (maxDifference) {
          maxDifference.value = 0
        }
        return 0
      }
    }

    let dc = 0
    let different = 0

    for (let j = 0; j < h; ++j) {
      let offset = j * stride

      v = memcmp(data1.data, data2.data, stride, offset)

      if (v) {
        for (let i = 0; i < w; ++i) {
          if (memcmp(data1.data, data2.data, 4, offset)) {
            different++

            Math.max(Math.abs(data1.data[offset] - data2.data[offset]),
                     Math.abs(data1.data[offset + 1] - data2.data[offset + 1]),
                     Math.abs(data1.data[offset + 2] - data2.data[offset + 2]),
                     Math.abs(data1.data[offset + 3] - data2.data[offset + 3]),
                     dc)
          }

          offset += 4
        }
      }
    }

    if (maxDifference) {
      maxDifference.value = dc
    }

    return different
  }

  drawInto(canvas1)
  return () => {
    drawInto(canvas2)
    let o = {}
    let n = compareCanvases(canvas1, canvas2, o)
    if (n === 0) {
      return ''
    }
    return (
      n + ' pixel' + (n === 1 ? '' : 's') + ' differ (max channel difference: ' + o.value + ')\n' +
      'Before:\n' + canvas1.toDataURL() + '\n' +
      'After:\n' + canvas2.toDataURL() + '\n'
    )
  }
}

window.wrappedJSObject.fuzzPriv = cloneInto({
  quitApplication: () => {
    dump('fuzzPriv.quitApplication')
    port.postMessage({cmd: 'quitApplication'})
  },

  quitApplicationSoon: () => {
    dump('fuzzPriv.quitApplicationSoon')
    port.postMessage({cmd: 'quitApplicationSoon'})
  },

  toString: () => { return '[DOMFuzzHelper]' },

  closeTabThenQuit: () => {
    port.postMessage({cmd: 'quitApplicationSoon'})
    window.close()
  },

  // Large object caching
  get: (key) => {
    return new window.wrappedJSObject.Promise(exportFunction((resolve, reject) => {
      port.postMessage({cmd: 'cacheGet', key: key, token: cacheRequests.push([resolve, reject])})
    }, window.wrappedJSObject))
  },
  set: (key, value) => {
    port.postMessage({cmd: 'cacheSet', key: key, value: value})
  },

  // Garbage collection
  forceGC: gc,
  GC: gc,
  CC: cc,
/*
  comparePixels: comparePixels,
  cssPropertyDatabase: cssPropertyDatabase.bind(this),
  webidlDatabase: webidlDatabase.bind(this),

  // Requests for things that Firefox or users do sometimes
  getMemoryReports: getMemoryReports.bind(this),
  printToFile: printToFile(aWindow),
*/
  openAboutNewtab: () => window.open('about:newtab'),
  resizeTo: (w, h) => port.postMessage({cmd: 'resizeTo', width: w, height: h}),
/*
  trustedKeyEvent: trustedKeyEvent(aWindow),
  callDrawWindow: callDrawWindow(aWindow),
  enableAccessibility: enableAccessibility.bind(this),
*/
  zoom: (factor) => port.postMessage({cmd: 'zoom', factor: factor})
/*
  enableBookmarksToolbar: function() { sendAsyncMessage('DOMFuzzHelper.enableBookmarksToolbar', {}) },
  disableBookmarksToolbar: function() { sendAsyncMessage('DOMFuzzHelper.disableBookmarksToolbar', {}) },
*/
}, window, {cloneFunctions: true})

port.onMessage.addListener((m) => {
  if (m.cmd === 'cacheGet') {
    let resolve, reject
    try {
      [resolve, reject] = cacheRequests[m.token - 1]
      cacheRequests[m.token - 1] = undefined
    } catch(e) {
      dump('unknown cache get token! ' + m.token + ' when requests array length is ' + cacheRequests.length + ' (' + e + ')')
      return
    }
    if ('value' in m) {
      resolve(m.value)
    } else {
      reject('response did not contain a value')
    }
    // clean-up the requests array
    while (cacheRequests.length && cacheRequests[cacheRequests.length - 1] === undefined) {
      cacheRequests.pop()
    }
  } else {
    dump('unhandled message from background: ' + m)
  }
})

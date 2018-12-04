"use strict";

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "categoryManager",
                                   "@mozilla.org/categorymanager;1",
                                   "nsICategoryManager");

function dumpln(s) { dump(s + "\n"); }

const CHILD_SCRIPT = "chrome://domfuzzhelper/content/fuzzPriv.js";

const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const CATMAN_CONTRACTID = "@mozilla.org/categorymanager;1";

const CATEGORY_NAME = "command-line-handler";
const CATEGORY_ENTRY = "m-fuzzinject";

/*****************
 * API INJECTION *
 *****************/

// Based on:
// https://bug549539.bugzilla.mozilla.org/attachment.cgi?id=429661
// https://developer.mozilla.org/en/XPCOM/XPCOM_changes_in_Gecko_1.9.3
// http://mxr.mozilla.org/mozilla-central/source/toolkit/components/console/hudservice/HUDService.jsm#3240
// https://developer.mozilla.org/en/how_to_build_an_xpcom_component_in_javascript
// https://developer.mozilla.org/en-US/docs/Command_Line (nsICommandLineHandler)

function DOMFuzzHelperObserver() {}

DOMFuzzHelperObserver.prototype = {
  factory:          XPCOMUtils._getFactory(DOMFuzzHelperObserver),
  classDescription: "DOMFuzz helper observer",
  classID:          Components.ID("{73DD0F4A-B201-44A1-8C56-D1D72432B02A}"),
  contractID:       "@mozilla.org/commandlinehandler/general-startup;1?type=fuzzinject",
  QueryInterface:   ChromeUtils.generateQI([Ci.nsICommandLineHandler]),

  init() {
    // Register for any messages our API needs us to handle
    Services.mm.addMessageListener("DOMFuzzHelper.quitApplication", this);
    Services.mm.addMessageListener("DOMFuzzHelper.quitApplicationSoon", this);
    Services.mm.addMessageListener("DOMFuzzHelper.quitWithLeakCheck", this);
    Services.mm.addMessageListener("DOMFuzzHelper.getProfileDirectory", this);
    Services.mm.addMessageListener("DOMFuzzHelper.enableAccessibility", this);
    Services.mm.addMessageListener("DOMFuzzHelper.getBinDirectory", this);
    Services.mm.addMessageListener("DOMFuzzHelper.enableBookmarksToolbar", this);
    Services.mm.addMessageListener("DOMFuzzHelper.disableBookmarksToolbar", this);
    Services.mm.loadFrameScript(CHILD_SCRIPT, true);
  },

  register() {
    Cm.registerFactory(this.classID, this.classDescription,
                       this.contractID, this.factory);
    categoryManager.addCategoryEntry(CATEGORY_NAME, CATEGORY_ENTRY,
                                     this.contractID, false, true);
  },

  uninit() {
    try { Services.obs.removeObserver(this, "chrome-document-global-created"); } catch(e) {}
    Services.mm.removeMessageListener("DOMFuzzHelper.quitApplication", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.quitApplicationSoon", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.quitWithLeakCheck", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.getProfileDirectory", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.enableAccessibility", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.getBinDirectory", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.enableBookmarksToolbar", this);
    Services.mm.removeMessageListener("DOMFuzzHelper.disableBookmarksToolbar", this);
    Services.mm.removeDelayedFrameScript(CHILD_SCRIPT, true);
  },

  unregister() {
    categoryManager.deleteCategoryEntry(CATEGORY_NAME, CATEGORY_ENTRY,
                                        this.contractID, false);
    Cm.unregisterFactory(this.classID, this.factory);
  },

  /**
    * messageManager callback function
    * This will get requests from our API in the window and process them in chrome for it
    **/

  receiveMessage(aMessage) {
    switch(aMessage.name) {
      case "DOMFuzzHelper.quitApplication":
        quitFromContent();
        break;

      case "DOMFuzzHelper.quitApplicationSoon":
        quitApplicationSoon();
        break;

      case "DOMFuzzHelper.quitWithLeakCheck":
        quitWithLeakCheck();
        break;

      case "DOMFuzzHelper.getProfileDirectory":
        return getProfileDirectory();

      case "DOMFuzzHelper.getBinDirectory":
        return getBinDirectory();

      case "DOMFuzzHelper.enableBookmarksToolbar":
        enableBookmarksToolbar();
        break;

      case "DOMFuzzHelper.disableBookmarksToolbar":
        disableBookmarksToolbar();
        break;

      case "DOMFuzzHelper.enableAccessibility":
        try {
          Cc["@mozilla.org/accessibilityService;1"]
            .getService(Ci.nsIAccessibilityService);
          dump("Enabled accessibility!\n");
        } catch(e) {
          dump("Couldn't enable accessibility: " + e + "\n");
        }

        break;

      default:
        dumpln("Unrecognized message sent to domfuzzhelperobserver.js");

    }
  },

  /* nsICommandLineHandler */
  handle(cmdLine) {
    if (cmdLine.handleFlag("fuzzinject", false)) {
      Services.mm.loadFrameScript("chrome://domfuzzhelper/content/inject.js", true);
      cmdLine.preventDefault = true;
    }
  },
  commandLineArgument: "-fuzzinject",
  helpText: "Enable injection of fuzz scripts",
  handlesArgs: true,
  defaultArgs: "",
  openWindowWithArgs: true,
  helpInfo: "  -fuzzinject          Enable injection of fuzz scripts\n",
};


/********************************************
 * MISC PRIVILEGED FUNCTIONS - MAIN PROCESS *
 ********************************************/

function runSoon(f)
{
  var tm = Cc["@mozilla.org/thread-manager;1"]
             .getService(Ci.nsIThreadManager);

  tm.mainThread.dispatch({
    run: function() {
      f();
    }
  }, Ci.nsIThread.DISPATCH_NORMAL);
}



function getProfileDirectory()
{
  var d = Cc["@mozilla.org/file/directory_service;1"]
                    .getService(Ci.nsIProperties)
                    .get("ProfD", Ci.nsIFile);
  return d.path;
}

function getBinDirectory()
{
  var d = Cc["@mozilla.org/file/directory_service;1"]
                    .getService(Ci.nsIProperties)
                    .get("CurProcD", Ci.nsIFile);
  return d.path;
}

function enableBookmarksToolbar()
{
  let browserWindow = Services.wm.getMostRecentWindow("navigator:browser");
  let personalToolbar = browserWindow.document.getElementById("PersonalToolbar");
  browserWindow.setToolbarVisibility(personalToolbar, true);
}

function disableBookmarksToolbar()
{
  let browserWindow = Services.wm.getMostRecentWindow("navigator:browser");
  let personalToolbar = browserWindow.document.getElementById("PersonalToolbar");
  browserWindow.setToolbarVisibility(personalToolbar, false);
}


/************************
 * QUIT WITH LEAK CHECK *
 ************************/

var quitting = false;

function quitWithLeakCheck(leaveWindowsOpen)
{
  // if not pref nglayout.debug.disable_xul_cache
  //   return

  leaveWindowsOpen = !!leaveWindowsOpen;

  // Magic string that domInteresting.py looks for
  var messagePrefix = "Leaked until " + (leaveWindowsOpen ? "tab close" : "shutdown");

  if (quitting)
    return;
  quitting = true;

  runSoon(a);
  function a() { dumpln("QA"); if (!leaveWindowsOpen) closeAllWindows(); runOnTimer(b); dumpln("QAA"); }
  function b() { dumpln("QB"); mpUntilDone(c); }
  function c() { dumpln("QC"); bloatStats(d); }
  function d(objectCounts) {
    dumpln("QD");

    // Mac normally has extra documents (due to the hidden window?)
    var isMac = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).OS == "Darwin";

    var expected = {
      'nsGlobalWindow':          4 + 6*leaveWindowsOpen,
      'nsDocument':              4 + 4*isMac + 24*leaveWindowsOpen,
      'nsDocShell':              5,
      'BackstagePass':           1,
      'nsGenericElement':        1927,
      'nsHTMLDivElement':        4,
      'xpc::CompartmentPrivate': 3,
    };

    for (var p in expected) {
      if (objectCounts[p] > expected[p]) {
        dumpln(messagePrefix + ": " + p + "(" + objectCounts[p] + " > " + expected[p] + ")");
      } else if (objectCounts[p] < expected[p]) {
        dumpln("That's odd"  + ": " + p + "(" + objectCounts[p] + " < " + expected[p] + ")");
      }
    }

    runSoon(e);
  }
  function e() { dumpln("QE"); quitOnce(); }
}

var timerDeathGrip;
function runOnTimer(f)
{
    timerDeathGrip = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timerDeathGrip.initWithCallback({notify: function(){ timerDeathGrip=null; f(); }}, 4000, Ci.nsITimer.TYPE_ONE_SHOT);
}

function closeAllWindows()
{
  var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                     .getService(Ci.nsIWindowWatcher);
  var enumerator = ww.getWindowEnumerator();

  var windowsToClose = [];

  while (enumerator.hasMoreElements()) {
    windowsToClose.push(enumerator.getNext().QueryInterface(Ci.nsIDOMWindow));
  }

  // if not mac...
  ww.openWindow(null, "about:blank", null, "width=200,height=200", null);

  for (var i = 0; i < windowsToClose.length; ++i) {
    windowsToClose[i].close();
  }

  dumpln("1");
}

function mpUntilDone(callback)
{
  function mpUntilDoneInner()
  {
    dumpln("MP " + j);
    sendMemoryPressureNotification();

    ++j;
    if (j > 9)
      runSoon(callback);
    else if (j % 2 == 1 && typeof Cu.schedulePreciseGC == "function")
      Cu.schedulePreciseGC(mpUntilDoneInner);
    else
      runSoon(mpUntilDoneInner);
  }

  var j = 0;
  mpUntilDoneInner();
}


/*
     |<----------------Class--------------->|<-----Bytes------>|<----------------Objects---------------->|<--------------References-------------->|
                                              Per-Inst   Leaked    Total      Rem      Mean       StdDev     Total      Rem      Mean       StdDev

*/
// Grab the class name and the number of remaining objects.
var bloatRex = /\s*\d+\s+(\S+)\s+\d+\s+\d+\s+\d+\s+(\d+)\s+.*/;
const SET_QUOTA = false;
const USE_QUOTA = false;

function bloatStats(callback)
{
  var objectCounts = {};

  try {
    //d.d.d;
    NetUtil.asyncFetch("about:bloat", fetched);
  } catch(e) {
    dumpln("Can't open about:bloat -- maybe you forgot to use XPCOM_MEM_LEAK_LOG");
    callback(objectCounts);
  }

  function fetched(aInputStream, aResult)
  {
    var r = NetUtil.readInputStreamToString(aInputStream, aInputStream.available());
    var lines = r.split("\n");
    for (var i = 0; i < lines.length; ++i)
    {
      var a = bloatRex.exec(lines[i]);
      if (a) {
        if (SET_QUOTA) {
          dumpln("'" + a[1] + "': " + a[2] + ",");
        } else if (USE_QUOTA) {
          var quotaA = QUOTA[a[1]] || 0;
          if (a[2] > quotaA) { dumpln("Leak? Too many " + a[1] + " (" + a[2] + " > " + quotaA + ")"); }
        }
        objectCounts[a[1]] = a[2];
      }
    }
    runSoon(callCallback);
  }

  function callCallback()
  {
    callback(objectCounts);
  }
}


/********
 * QUIT *
 ********/

// goQuitApplication and canQuitApplication are from quit.js,
// which Bob Clary extracted from mozilla/toolkit/content

function canQuitApplication()
{
  var os = Cc["@mozilla.org/observer-service;1"]
    .getService(Ci.nsIObserverService);
  if (!os)
  {
    return true;
  }

  try
 {
    var cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
      .createInstance(Ci.nsISupportsPRBool);
    os.notifyObservers(cancelQuit, "quit-application-requested", null);

    // Something aborted the quit process.
    if (cancelQuit.data)
    {
      return false;
    }
  }
  catch (ex)
  {
  }
  os.notifyObservers(null, "quit-application-granted", null);
  return true;
}

function goQuitApplication()
{
  dumpln("goQuitApplication (domfuzzhelperobserver.js component)");

  if (!canQuitApplication())
  {
    return false;
  }

  var kAppStartup = '@mozilla.org/toolkit/app-startup;1';
  var kAppShell   = '@mozilla.org/appshell/appShellService;1';
  var   appService;
  var   forceQuit;

  if (kAppStartup in Cc)
  {
    appService = Cc[kAppStartup].
      getService(Ci.nsIAppStartup);
    forceQuit  = Ci.nsIAppStartup.eForceQuit;

  }
  else if (kAppShell in Cc)
  {
    appService = Cc[kAppShell].
      getService(Ci.nsIAppShellService);
    forceQuit = Ci.nsIAppShellService.eForceQuit;
  }
  else
  {
    throw 'goQuitApplication: no AppStartup/appShell';
  }

  var windowManager = Components.
    classes['@mozilla.org/appshell/window-mediator;1'].getService();

  var windowManagerInterface = windowManager.
    QueryInterface(Ci.nsIWindowMediator);

  var enumerator = windowManagerInterface.getEnumerator(null);

  while (enumerator.hasMoreElements())
  {
    var domWindow = enumerator.getNext();
    if (("tryToClose" in domWindow) && !domWindow.tryToClose())
    {
      return false;
    }
    domWindow.close();
  }

  try
  {
    appService.quit(forceQuit);
  }
  catch(ex)
  {
    throw('goQuitApplication: ' + ex);
  }

  return true;
}


// Use runSoon to avoid false-positive leaks due to content JS on the stack (?)
function quitFromContent() { dumpln("Page called quitApplication."); runSoon(quitOnce); }
function quitApplicationSoon() { dumpln("Page called quitApplicationSoon."); runOnTimer(quitOnce); }

var alreadyQuitting = false;
function quitOnce()
{
  if (alreadyQuitting) {
    dumpln("But I'm already quitting!");
  } else {
    alreadyQuitting = true;
    goQuitApplication();
  }
}

function startup(data, reason) {
  DOMFuzzHelperObserver.prototype.init();
  DOMFuzzHelperObserver.prototype.register();
}

function shutdown(data, reason) {
  DOMFuzzHelperObserver.prototype.uninit();
  DOMFuzzHelperObserver.prototype.unregister();
}

function install(data, reason) {}
function uninstall(data, reason) {}

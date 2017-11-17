/*
 * fuzzpriv webextension edition
 *
 * background script
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
'use strict'

/* global browser */

const dump = (window.dump && ((msg) => window.dump(msg + '\n'))) || console.log

const grzHarnessUsesWindows = false

function quitApplication () {
  browser.windows.getAll()
    .then((windows) => {
      for (let win of windows) {
        browser.windows.remove(win.id).catch((e) => dump('error closing window: ' + e))
      }
    })
    .catch((e) => dump('error in quitApplication: ' + e))
}

function kickoffGrizzlyHarness (timeout, location) {
  const grzdump = (msg) => dump('[grizzly harness][' + new Date().toGMTString() + '] ' + msg)

  let limitTmr, sub
  let reqUrl = '/first_test'

  if (timeout <= 0) {
    grzdump('No time limit given, using default of 5s')
    timeout = 5000
  } else {
    grzdump('Using time limit of ' + timeout)
  }

  function grzHarness () {
    // grizzly harness
    (grzHarnessUsesWindows ? browser.windows.create({allowScriptsToClose: true, url: location + reqUrl})
                           : browser.tabs.create({url: location + reqUrl}))
      .then((result) => { sub = result })
      .catch((e) => grzdump('error launching test case: ' + e))

    limitTmr = setTimeout(() => {
      limitTmr = undefined
      grzdump('Time limit exceeded')
      let remove = grzHarnessUsesWindows ? browser.windows.remove : browser.tabs.remove
      remove(sub.id)
        .then(() => grzdump('Closed test case'))
        .catch((e) => grzdump('Error closing test case: ' + e))
    }, timeout)
    reqUrl = '/next_test'
  }

  function onremove (id) {
    // grzdump('removed: ' + id)
    if (id === (sub && sub.id)) {
      if (limitTmr !== undefined) {
        clearTimeout(limitTmr)
        grzdump('Test case closed itself')
      }
      grzHarness() // go to next reqUrl
    }
  }
  browser.tabs.onRemoved.addListener(onremove)
  browser.windows.onRemoved.addListener(onremove)

  grzHarness() // kick-off
}

browser.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((m) => {
    if (m.cmd === 'quitApplication') {
      quitApplication()
    } else if (m.cmd === 'quitApplicationSoon') {
      setTimeout(quitApplication, 4000)
    } else if (m.cmd === 'grizzlyHarness') {
      kickoffGrizzlyHarness(m.timeout, m.location).catch((e) => dump('error in kickoffGrizzlyHarness: ' + e))
    } else if (m.cmd === 'resizeTo') {
      if (!('width' in m)) {
        dump('error in resizeTo: missing parameter: width')
      } else if (!('height' in m)) {
        dump('error in resizeTo: missing parameter: height')
      } else {
        function clamp (a, b, c) {
          return Math.max(a, Math.min(b, c))
        }
        browser.windows.getCurrent().then((win) => {
          browser.windows.update(win.id, {
            width: clamp(200, m.width, 4000),
            height: clamp(200, m.height, 2250)
          })
        })
      }
    } else if (m.cmd === 'zoom') {
      if ('factor' in m) {
        browser.tabs.setZoom(undefined, +m.factor)
      } else {
        dump('error in zoom: missing parameter: factor')
      }
    } else {
      dump('unhandled message from content: ' + m)
    }
  })
})

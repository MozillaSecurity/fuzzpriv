fuzzPriv fuzzing helper extension

This is still alpha quality and not fully tested. Some parts are not yet working compared to the legacy version,
some parts will never work, and some parts work differently. You probably want the [legacy version](tree/legacy) instead.

The GC/CC functions require --fuzzing enabled builds (eg. [linux64-asan](https://tools.taskcluster.net/index/gecko.v2.mozilla-central.latest.firefox/linux64-fuzzing-asan-opt), [linux64-debug](https://tools.taskcluster.net/index/gecko.v2.mozilla-central.latest.firefox/linux64-fuzzing-debug), [macosx64-asan](https://tools.taskcluster.net/index/gecko.v2.mozilla-central.latest.firefox/macosx64-fuzzing-asan-opt)) with the following prefs:

    user_pref("fuzzing.enabled", true);
    user_pref("xpinstall.signatures.required", false);

default:
	zip -r fuzzpriv@fuzzing.mozilla.org.xpi browser-polyfill.min.js fuzzpriv.js inject.js manifest.json

clean:
	rm fuzzpriv@fuzzing.mozilla.org.xpi


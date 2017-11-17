default:
	zip -r domFuzzLite3.xpi . -x Makefile -x README.md -x domFuzzLite3.xpi

clean:
	rm domFuzzLite3.xpi

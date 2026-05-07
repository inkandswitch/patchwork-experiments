// Used to load buffers of sound files to be played by source nodes.
// Based on code from the 2013 Web Audio API book
export default class BufferLoader {
    context: AudioContext | null;
    urlList: string[];
    onload: (bufferList: any[]) => void;
    bufferList: any[];
    loadCount: number;

    constructor(urlList: string[], callback: (bufferList: any[]) => void) {
        this.context = null;
        this.urlList = urlList;
        this.onload = callback;
        this.bufferList = new Array();
        this.loadCount = 0;
    }

    loadBuffer(url: string, index: number) {
        console.log("[BufferLoader] Loading buffer", index, "from URL:", url?.substring(0, 100));
        var request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.responseType = "arraybuffer";
        var loader = this;
        request.onload = function () {
            console.log("[BufferLoader] Loaded buffer", index, "status:", request.status);
            if (!loader.context) {
                console.error("BufferLoader expected AudioContext to be loaded.");
                return
            }
            loader.context.decodeAudioData(
                request.response,
                function (buffer) {
                    if (!buffer) {
                        console.error('error decoding file data: ' + url);
                        return;
                    }
                    loader.bufferList[index] = buffer;
                    if (++loader.loadCount == loader.urlList.length)
                        loader.onload(loader.bufferList);
                }
            );
        }
        request.onerror = function () {
            console.error('[BufferLoader] XHR error for buffer', index, 'url:', url?.substring(0, 100));
        }
        request.send();
    }

    load(context: AudioContext) {
        this.context = context;
        for (var i = 0; i < this.urlList.length; ++i)
            this.loadBuffer(this.urlList[i], i);
    }
}

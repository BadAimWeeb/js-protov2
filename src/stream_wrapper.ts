import { Duplex } from "stream";
import type { Stream } from "@libp2p/interface-connection";
import { write } from "fs";

export function convertLibp2pStream(stream: Stream) {
    let duplex = new Duplex({
        read() { },
        write(chunk, encoding, next) {
            // Convert data to Uint8Array
            let data = chunk;
            if (typeof chunk === "string") {
                data = Buffer.from(chunk, encoding);
            }

            data = new Uint8Array(data);
            
            // Write data to stream
            stream.sink(data)
                .then(() => next())
                .catch((err) => next(err));
        },
        allowHalfOpen: true,
        destroy(err, callback) {
            stream.close();
            callback(err);
        },
        final(callback) {
            stream.closeWrite();
            callback();
        }
    });

    (async () => {
        for await (let chunk of stream.source) {
            duplex.push(chunk);
        }

        // Close the stream
        duplex.push(null);
    })();

    return duplex;
}
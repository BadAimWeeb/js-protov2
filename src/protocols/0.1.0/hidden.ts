import type ProtoV2 from "../..";
import type { Connection, Stream } from "@libp2p/interface-connection";

import debug from "debug";
import { decode, encode } from "msgpack-lite";
import { randomString } from "../../utils.js";
import { convertLibp2pStream } from "../../stream_wrapper.js";

const log = debug("protov2:hidden_proto:0.1.0");

export default (protov2: ProtoV2, connection: Connection, stream: Stream) => {
    log(`connection from ${connection.remotePeer.toString()}`);

    let handshaked = false;
    let verificationString = randomString(32);
    let njsStream = convertLibp2pStream(stream);

    njsStream.on("data", (d) => {
        try {
            let buf = Uint8Array.from(d);
            let data = decode(buf.slice(1));

            switch (buf[0]) {
                case 0x01: {
                    // Relay/discovery protocol
                    let op = data.op as number;
                    switch (op) {
                        case 0:
                            let appID = data.appID as string;
                            if (!Object.hasOwn(protov2.config.identifiers, appID)) {
                                // Check cache
                                if (Object.hasOwn(protov2._publicCache, appID)) {
                                    // Send cached data with OP 1
                                    njsStream.write(encode({
                                        op: 1,
                                        addresses: [...protov2._publicCache[appID].keys()]
                                    }));
                                } else {
                                    // Reject with OP 5
                                    njsStream.write(encode({
                                        op: 5
                                    }));
                                }
                                njsStream.end();
                            } else {
                                let hasPath = false;
                                let hasCache = false;

                                // Test if we have connections to this appID
                                if (Object.hasOwn(protov2._activePath, appID) && protov2._activePath[appID].size > 0) {
                                    hasPath = true;
                                }

                                // Test if we have cached data for this appID
                                if (Object.hasOwn(protov2._publicCache, appID) && protov2._publicCache[appID].size > 0) {
                                    hasCache = true;
                                }

                                if (hasPath && hasCache) {
                                    // Return OP 2
                                    njsStream.write(encode({
                                        op: 2,
                                        addresses: [...protov2._publicCache[appID].keys()],
                                        verify: verificationString
                                    }));
                                } else if (hasPath) {
                                    // Return OP 3
                                    njsStream.write(encode({
                                        op: 3,
                                        verify: verificationString
                                    }));
                                } else if (hasCache) {
                                    // Only send cached data with OP 1
                                    njsStream.write(encode({
                                        op: 1,
                                        addresses: [...protov2._publicCache[appID].keys()]
                                    }));
                                    njsStream.end();
                                } else {
                                    // Return OP 4
                                    njsStream.write(encode({
                                        op: 4
                                    }));
                                    njsStream.end();
                                }
                            }
                            break;
                    }
                }
            }
        } catch {

        }
    });
}
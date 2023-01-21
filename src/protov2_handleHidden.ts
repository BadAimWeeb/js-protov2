import type ProtoV2 from ".";
import type { Connection, Stream } from "@libp2p/interface-connection";
import { SUPPORTED_PROTOCOL_VERSION } from "./constant.js";
import * as semver from "semver";
import { decode, encode } from "msgpack-lite";

import { convertLibp2pStream } from "./stream_wrapper.js";

import debug from "debug";
const log = debug("protov2:hidden_proto");

const TABLE_HIDDEN_PROTOCOL: {
    [version: string]: (protov2: ProtoV2, connection: Connection, stream: Stream) => void;
} = {
    "0.1.0": (protov2, connection, stream) => {
        log(`ProtoV2H 0.1.0 from ${connection.remotePeer.toString()}`);

        let handshaked = false;
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
                                        // Send cached data
                                        njsStream.write(encode({
                                            op: 1,
                                            addresses: [...protov2._publicCache[appID].keys()]
                                        }));
                                    } else {
                                        // Reject with OP 5
                                        njsStream.write(encode({
                                            op: 5
                                        }));
                                        njsStream.end();
                                    }
                                } else {
                                    
                                }
                        }
                    }
                }
            } catch {

            }
        });
    }
}

export default function handleHiddenConnections(protov2: ProtoV2) {
    // If other nodes connect to /protov2, use latest protocol version
    let latestProtoVersion = SUPPORTED_PROTOCOL_VERSION
        .sort((a, b) => semver.gt(a, b) ? 1 : -1)[0];

    protov2.libp2p.libp2p!.handle("/protov2", (data) => TABLE_HIDDEN_PROTOCOL[latestProtoVersion](protov2, data.connection, data.stream));

    // If other nodes connect to /protov2/VERSION, use that protocol version
    for (let version in SUPPORTED_PROTOCOL_VERSION) {
        protov2.libp2p.libp2p!.handle(`/protov2/${version}`, (data) => TABLE_HIDDEN_PROTOCOL[version](protov2, data.connection, data.stream));
    }
}

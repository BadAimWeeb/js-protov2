import type ProtoV2 from ".";
import * as semver from "semver";
import type { Connection, Stream } from "@libp2p/interface-connection";

import normal_0_1_0 from "./protocols/0.1.0/normal.js";

const TABLE_PROTOCOL: {
    [version: string]: (protov2: ProtoV2, appID: string, connection: Connection, stream: Stream) => void;
} = {
    "0.1.0": normal_0_1_0
}

export default function handleApplicationConnections(protov2: ProtoV2) {
    let SUPPORTED_PROTOCOL_VERSION = Object.keys(TABLE_PROTOCOL);

    for (let appID in protov2.config.identifiers) {
        // Requires private key to accept connections
        if (protov2.config.identifiers[appID].privateKey) {
            // If other nodes connect to /protov2/APPID, use latest protocol version
            let latestProtoVersion = SUPPORTED_PROTOCOL_VERSION
                .sort((a, b) => semver.gt(a, b) ? 1 : -1)[0];

            protov2.libp2p.libp2p!.handle(`/protov2/${appID}`, (data) => TABLE_PROTOCOL[latestProtoVersion](protov2, appID, data.connection, data.stream));

            // If other nodes connect to /protov2/APPID/VERSION, use that protocol version
            for (let version in SUPPORTED_PROTOCOL_VERSION) {
                protov2.libp2p.libp2p!.handle(`/protov2/${appID}/${version}`, (data) => TABLE_PROTOCOL[version](protov2, appID, data.connection, data.stream));
            }
        }
    }
}
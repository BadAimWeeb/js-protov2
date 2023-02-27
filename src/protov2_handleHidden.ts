import type ProtoV2 from ".";
import type { Connection, Stream } from "@libp2p/interface-connection";
import * as semver from "semver";

import debug from "debug";
//const log = debug("protov2:hidden_proto");

import hidden_0_1_0 from "./protocols/0.1.0/hidden.js";

const TABLE_HIDDEN_PROTOCOL: {
    [version: string]: (protov2: ProtoV2, connection: Connection, stream: Stream) => void;
} = {
    "0.1.0": hidden_0_1_0
}

export default function handleHiddenConnections(protov2: ProtoV2) {
    let SUPPORTED_PROTOCOL_VERSION = Object.keys(TABLE_HIDDEN_PROTOCOL);

    // If other nodes connect to /protov2, use latest protocol version
    let latestProtoVersion = SUPPORTED_PROTOCOL_VERSION
        .sort((a, b) => semver.gt(a, b) ? 1 : -1)[0];

    protov2.libp2p.libp2p!.handle("/protov2", (data) => TABLE_HIDDEN_PROTOCOL[latestProtoVersion](protov2, data.connection, data.stream));

    // If other nodes connect to /protov2/VERSION, use that protocol version
    for (let version in SUPPORTED_PROTOCOL_VERSION) {
        protov2.libp2p.libp2p!.handle(`/protov2/${version}`, (data) => TABLE_HIDDEN_PROTOCOL[version](protov2, data.connection, data.stream));
    }
}

import type { PeerInfo } from "@libp2p/interface-peer-info";
import type { Connection, Stream } from "@libp2p/interface-connection";
import type { Multiaddr } from "@multiformats/multiaddr";
import * as EventEmitter from "events";

import { SUPPORTED_PROTOCOL_VERSION } from "./constant.js";
import P2P from "./libp2p.js";
import handleDiscovery from "./protov2_discovery.js";

export type Config = {
    isNodejs?: boolean;

    identifiers: {
        [appID: string]: {
            symmetricKey: string; //  used for relay verification
            publicKeys?: string[]; // client-only: used for endpoint verification
            privateKey?: string; //   server-only: used for endpoint verification
            hiddenNode?: boolean; //  server-only: do not broadcast this node as a public server
        }
    }[];

    bootstrap?: string[];

    listenAddrs?: string[];
    announceAddrs?: string[];
    appendAnnounceAddrs?: string[];
    noAnnounceAddrs?: string[];
}

export default interface ProtoV2 extends EventEmitter {
    on(event: "libp2p:peer:connect", listener: (peerInfo: CustomEvent<Connection>) => void): this;
    on(event: "libp2p:peer:disconnect", listener: (peerInfo: CustomEvent<Connection>) => void): this;
    on(event: "libp2p:peer:discovery", listener: (peerInfo: CustomEvent<PeerInfo>) => void): this;
    on(event: "protov2:discover", listener: (info: {
        id: string,
        addresses: Multiaddr[],
        versions: string[];
        apps: {
            [appID: string]: string[]
        }
    }) => void): this;
}

export default class ProtoV2 extends EventEmitter {
    static compatibleVersions = SUPPORTED_PROTOCOL_VERSION;

    _listenAppID: string[];

    _publicCache: {
        [appID: string]: Map<string, {
            versions: string[],
            addresses: Multiaddr[]
        }>
    } = {};

    _hiddenNodesCache: Map<string, {
        versions: string[],
        addresses: Multiaddr[]
    }> = new Map();

    _activePath: {
        [appID: string]: Set<{
            public: boolean,
            score: number,
            hop: number,
            stream: Stream
        }>
    } = {}

    config: Config;
    libp2p: P2P;

    constructor(config: Config) {
        super();

        this.config = config;
        this._listenAppID = Object.keys(config.identifiers);
        this.libp2p = new P2P({
            isNodejs: config.isNodejs,
            bootstrapAddrs: config.bootstrap,
            listenAddrs: config.listenAddrs,
            announceAddrs: config.announceAddrs,
            appendAnnounceAddrs: config.appendAnnounceAddrs,
            noAnnounceAddrs: config.noAnnounceAddrs
        });

        this.libp2p.waitLibp2p().then(p2p => {
            p2p.addEventListener("peer:connect", (peerInfo: CustomEvent<Connection>) => {
                this.emit("libp2p:peer:connect", peerInfo);
            });
            p2p.addEventListener("peer:disconnect", (peerInfo: CustomEvent<Connection>) => {
                this.emit("libp2p:peer:disconnect", peerInfo);
            });
            p2p.addEventListener("peer:discovery", (peerInfo: CustomEvent<PeerInfo>) => {
                this.emit("libp2p:peer:discovery", peerInfo);
            });
        });

        handleDiscovery(this);
    }

    async start() {
        await this.libp2p.start();
        let libp2p = this.libp2p.libp2p!;
    }

    async stop() {
        await this.libp2p.stop();
        let libp2p = this.libp2p.libp2p!;
    }
}

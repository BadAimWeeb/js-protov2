import type { PeerInfo } from "@libp2p/interface-peer-info";
import type { Connection, Stream } from "@libp2p/interface-connection";
import type { Multiaddr } from "@multiformats/multiaddr";
import * as EventEmitter from "events";

import P2P from "./libp2p.js";
import handleDiscovery from "./protov2_discovery.js";
import type { Duplex } from "stream";
import ProtoV2Session from "./session.js";

export type Config = {
    /** Enable specific protocols that are only available in Node, and disable specific protocols that are (temporary) only available in browser. */
    isNodejs?: boolean;

    /** Allow for listening and/or (hidden) relaying for applications */
    identifiers: {
        [appID: string]: {
            /** This will be used for relay/client verification. */
            symmetricKey: string;
            /** This will be used to make sure you are connecting to correct servers. */
            publicKeys?: string[];
            /** This will be used to sign new keys and making sure that clients are talking to correct server (Root CA?). */
            privateKey?: string;
            /** Do not broadcast support for this application (as a public server), only serves through hidden proto (WIP). */
            hiddenNode?: boolean;
        }
    };

    /** Bootstrap nodes: Will be connected first to quickly intergate to P2P network (and be able to connect to server quickly). */
    bootstrap?: string[];

    /** Listening address to let other nodes to connect to this node. */
    listenAddrs?: string[];
    /** If set, this set of address will be broadcasted instead. */
    announceAddrs?: string[];
    /** If set, addresses matched address inside this will not be broadcasted. */
    noAnnounceAddrs?: string[];

    /** How many milliseconds after disconnection before session deletion. */
    resumptionWait?: number;
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
            stream: Stream,
            connection: Connection
        }>
    } = {}

    _activeListen: {
        [appID: string]: Map<string, ProtoV2Session>
    } = {};

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

    async connect(appID: string, serverHash?: string): Promise<[serverHash: string, connection: Duplex]> {
        if (!this._listenAppID.includes(appID)) {
            throw new Error(`AppID ${appID} is not registered`);
        }

        let serverList = new Map<string, {}>();
        for (; ;) {
            let serverInfo = this._publicCache[appID];


        }
    }

    async start() {
        await this.libp2p.start();
    }

    async stop() {
        await this.libp2p.stop();
    }
}

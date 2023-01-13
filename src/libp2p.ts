import * as EventEmitter from 'events';
import { createLibp2p, Libp2p, Libp2pOptions } from 'libp2p';

// WebRTC for Node.js
// @ts-ignore
import wrtc from "wrtc";

// Transports
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webTransport } from '@libp2p/webtransport';
import { webRTC } from "@libp2p/webrtc"; // newer version of WebRTC protocol (browser-only for now)
import { webRTCStar } from '@libp2p/webrtc-star'; // older version of WebRTC protocol, allows for direct connections between browsers (use signaling server)

// Encryption
import { noise } from '@chainsafe/libp2p-noise';

// Multiplexing
import { mplex } from "@libp2p/mplex";
import { yamux } from "@chainsafe/libp2p-yamux";

// Discovery
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';

// DHT (including Discovery)
import { kadDHT } from '@libp2p/kad-dht';

// PubSub
import { gossipsub } from '@chainsafe/libp2p-gossipsub';

export default class P2P extends EventEmitter {
    libp2p?: Libp2p;
    _lock_init: Promise<void>;

    constructor(isNodejs: boolean = false) {
        super();

        let resolveLock: () => void;
        this._lock_init = new Promise<void>(resolve => resolveLock = resolve);

        (async () => {
            let transportList: (Libp2pOptions["transports"]) = [];
            let peerDiscoveryList: (Libp2pOptions["peerDiscovery"]) = [];

            // Different configuration for Node.js and browser
            let wrtcStar: ReturnType<typeof webRTCStar>;
            if (isNodejs) {
                transportList.push(tcp());

                wrtcStar = webRTCStar({ wrtc });
                transportList.push(wrtcStar.transport);
                peerDiscoveryList.push(wrtcStar.discovery);

                peerDiscoveryList.push(mdns());
            } else {
                transportList.push(webTransport());
                transportList.push(webRTC());

                wrtcStar = webRTCStar();
                transportList.push(wrtcStar.transport);
                peerDiscoveryList.push(wrtcStar.discovery);
            }
            transportList.push(webSockets());
            peerDiscoveryList.push(bootstrap({
                list: [
                    // TODO: Add known peers here
                    "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
                    "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
                    "/dns/ipfs-a02-cf.badaimweeb.me/tcp/443/wss/p2p/12D3KooWHeD2fKFK6LumJGjtWS4oh3v4TsDex1Q1ftgJaco5QWvn"
                ]
            }));

            let libp2p = await createLibp2p({
                start: false,
                transports: transportList,
                peerDiscovery: peerDiscoveryList,
                connectionEncryption: [
                    noise()
                ],
                streamMuxers: [
                    mplex(),
                    yamux()
                ],
                dht: kadDHT(),
                pubsub: gossipsub(),
                relay: {
                    enabled: true
                }
            });

            this.libp2p = libp2p;
            resolveLock();
        })();
    }

    async start() {
        await this._lock_init;
        await this.libp2p!.start();
    }

    async stop() {
        await this._lock_init;
        await this.libp2p!.stop();
    }

    async waitLibp2p() {
        await this._lock_init;
        return this.libp2p!;
    }
}
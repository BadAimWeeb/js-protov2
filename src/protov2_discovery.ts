import type ProtoV2 from ".";
import { SUPPORTED_PROTOCOL_VERSION } from "./constant.js";
import * as semver from "semver";

import debug from "debug";
const log = debug("protov2:discovery");

export default function handleDiscovery(protov2: ProtoV2) {
    protov2.on("libp2p:peer:discovery", peerInfo => {
        let peerID = peerInfo.detail.id.toString();
        let protocols = peerInfo.detail.protocols;
        
        let isProtoV2 = !!protocols.find(p => p === "/protov2");
        if (!isProtoV2) return;

        let acceptVersions = protocols.filter(p => p.startsWith("/protov2/"))
            .filter(p => p.split("/").length === 3)
            .map(p => p.split("/")[2])
            .filter(p => semver.valid(p));

        if (acceptVersions.length === 0) return;
        let highestVersion = semver.maxSatisfying(acceptVersions, SUPPORTED_PROTOCOL_VERSION.join(" || "));
        log("Found peer %s advertising support for ProtoV2 protocol version(s) %s; max version is %s", peerID, acceptVersions.join(", "), highestVersion || "none");
        if (!highestVersion) return;

        // Detect apps
        let rawApps = protocols.filter(p => p.startsWith("/protov2/"))
            .filter(p => p.split("/").length === 4)
            .filter(p => !semver.valid(p.split("/")[3]))

        let apps: {
            [appID: string]: string[]
        } = {};

        for (let app of rawApps) {
            let [_, __protov2, appID, version] = app.split("/");
            if (!apps[appID]) apps[appID] = [];
            apps[appID].push(version);
        }

        for (let appID of Object.keys(apps)) {
            let versions = apps[appID];
            let highestVersion = semver.maxSatisfying(versions, SUPPORTED_PROTOCOL_VERSION.join(" || "));
            log("Found peer %s advertising support for ProtoV2 app %s protocol version(s) %s; max version is %s", peerID, appID, versions.join(", "), highestVersion || "none");

            if (!protov2._publicCache[appID]) protov2._publicCache[appID] = new Map();
            protov2._publicCache[appID].set(peerID, {
                versions,
                addresses: peerInfo.detail.multiaddrs
            });
        }

        protov2.emit("protov2:discover", {
            versions: acceptVersions,
            apps,
            id: peerID,
            address: peerInfo.detail.multiaddrs
        });
    });
}
import pkg from "superdilithium";
const { superDilithium } = pkg;

console.log("BadAimWeeb - ProtoV2 Utilities: Keypair Generator");
console.log("=".repeat(process.stdout.columns));
console.log("REMEMBER: DO NOT SHARE YOUR PRIVATE KEY WITH ANYONE!");
console.log("Private key is used to let client verify your server to make sure that they are talking to correct server.");
console.log("ONLY PUBLIC KEY IS NEEDED TO BE SHARED WITH CLIENTS.");
console.log("");
console.log("IN CASE OF COMPROMISE, PLEASE GENERATE NEW KEYPAIR IMMEDIATELY.");
console.log("=".repeat(process.stdout.columns));
console.log("");

let key = await superDilithium.keyPair();

console.log("Private key:");
console.log(Array.from(key.privateKey).map(x => x.toString(16).padStart(2, "0")).join(""));

console.log("");
console.log("=".repeat(process.stdout.columns));
console.log("");

console.log("Public key:");
console.log(Array.from(key.publicKey).map(x => x.toString(16).padStart(2, "0")).join(""));
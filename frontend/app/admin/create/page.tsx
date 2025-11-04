"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import nacl from "tweetnacl";

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID;
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

export default function CreateFlightPage() {
  const router = useRouter();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [flightPub, setFlightPub] = useState("");
  const [maxPassengers, setMaxPassengers] = useState("");
  const [distance, setDistance] = useState("");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState("");
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState("");

  useEffect(() => {
    const key = sessionStorage.getItem("publicKey");
    const role = sessionStorage.getItem("userRole");

    if (!key || role !== "admin") {
      router.push("/");
      return;
    }

    setPublicKey(key);
    generateKeypair();
  }, []);

  const generateKeypair = () => {
    try {
      const seed = nacl.randomBytes(32);
      const kp = StellarSdk.Keypair.fromRawEd25519Seed(seed);
      const pub = kp.publicKey();
      const sec = kp.secret();

      setGeneratedPublicKey(pub);
      setGeneratedPrivateKey(sec);
      setFlightPub(pub);
    } catch (err) {
      console.error("Key generation failed:", err);
      toast.error("Failed to generate keypair");
    }
  };

  const handleCreateFlight = async () => {
    if (!publicKey) return toast.error("Connect wallet first!");
    if (!maxPassengers || !distance || !src || !dest) {
      return toast.error("Fill all fields!");
    }

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);
      const contract = new StellarSdk.Contract(CONTRACT_ID!);

      // ✅ Convert public key to BytesN<32>
      const flightKeypair = StellarSdk.Keypair.fromPublicKey(flightPub);
      const rawBytes = flightKeypair.rawPublicKey();

      // Create proper BytesN ScVal
      const flightIdScVal = StellarSdk.xdr.ScVal.scvBytes(rawBytes);

      // Build the operation first
      const operation = contract.call(
        "create_flight",
        flightIdScVal,
        StellarSdk.nativeToScVal(parseInt(maxPassengers), { type: "u32" }),
        StellarSdk.nativeToScVal(parseInt(distance), { type: "i128" }),
        StellarSdk.nativeToScVal(src, { type: "symbol" }),
        StellarSdk.nativeToScVal(dest, { type: "symbol" })
      );

      // Build transaction
      let tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(operation)
        .setTimeout(180)
        .build();

      // ✅ Simulate first to prepare the transaction
      const simulated = await server.simulateTransaction(tx);

      if (StellarRpc.Api.isSimulationError(simulated)) {
        console.error("Simulation error:", simulated);
        throw new Error("Transaction simulation failed");
      }

      // ✅ Prepare the transaction with simulation results
      tx = StellarRpc.assembleTransaction(tx, simulated).build();

      // Sign the prepared transaction
      const { signedTxXdr } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(
        signedTxXdr,
        NETWORK_PASSPHRASE
      );

      // Send transaction
      const response = await server.sendTransaction(txSigned);
      console.log("Transaction Response:", response);

      // Wait for confirmation
      if (response.status === "PENDING") {
        let getResponse = await server.getTransaction(response.hash);
        while (getResponse.status === "NOT_FOUND") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          getResponse = await server.getTransaction(response.hash);
        }

        if (getResponse.status === "SUCCESS") {
          toast.success("Flight created successfully!");
          setShowModal(true);
          setMaxPassengers("");
          setDistance("");
          setSrc("");
          setDest("");
          generateKeypair(); // Generate new keypair for next flight
        } else {
          console.error("Transaction failed:", getResponse);
          toast.error("Transaction failed");
        }
      } else if (response.status === "ERROR") {
        console.error("Transaction error:", response);
        toast.error("Transaction error");
      }
    } catch (err: any) {
      console.error("Error creating flight:", err);
      toast.error(err?.message || "Failed to create flight");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied!");
    } catch (err) {
      toast.error("Copy failed");
    }
  };

  if (!publicKey) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-8">
      <Toaster position="top-right" />

      <div className="max-w-4xl mx-auto">
        <Link
          href="/admin"
          className="mb-6 text-white/80 hover:text-white flex items-center gap-2 inline-flex"
        >
          ← Back to Dashboard
        </Link>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-6">Create New Flight</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-white/80 text-sm mb-2">
                Flight Public Address (auto-generated)
              </label>
              <input
                type="text"
                value={flightPub}
                className="w-full px-4 py-3 rounded-lg bg-white/20 text-white border border-white/30 focus:outline-none"
                readOnly
              />
              <p className="text-xs text-white/60 mt-2">
                The private key will be shown after successful creation.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/80 text-sm mb-2">Max Passengers</label>
                <input
                  type="number"
                  placeholder="150"
                  value={maxPassengers}
                  onChange={(e) => setMaxPassengers(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-2">Price per Ticket (XLM)</label>
                <input
                  type="number"
                  placeholder="100"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/80 text-sm mb-2">Source Airport</label>
                <input
                  type="text"
                  placeholder="BOM"
                  value={src}
                  onChange={(e) => setSrc(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-2">Destination Airport</label>
                <input
                  type="text"
                  placeholder="NYC"
                  value={dest}
                  onChange={(e) => setDest(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleCreateFlight}
              disabled={loading}
              className="w-full bg-white text-blue-900 font-semibold py-3 px-6 rounded-lg hover:bg-blue-50 transition disabled:opacity-50 mt-6"
            >
              {loading ? "Creating Flight..." : "Create Flight"}
            </button>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowModal(false)} />
            <div className="relative bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <h3 className="text-lg font-bold mb-4">Generated Flight Keypair</h3>

              <p className="text-sm text-gray-700 mb-2">Public Key</p>
              <div className="flex items-center gap-3 mb-4">
                <input
                  className="flex-1 font-mono text-sm px-3 py-2 rounded border"
                  readOnly
                  value={generatedPublicKey}
                />
                <button
                  onClick={() => copyToClipboard(generatedPublicKey)}
                  className="px-3 py-2 bg-blue-600 text-white rounded"
                >
                  Copy
                </button>
              </div>

              <p className="text-sm text-gray-700 mb-2">Private Secret Seed</p>
              <div className="flex items-center gap-3 mb-4">
                <input
                  className="flex-1 font-mono text-sm px-3 py-2 rounded border"
                  readOnly
                  value={generatedPrivateKey}
                />
                <button
                  onClick={() => copyToClipboard(generatedPrivateKey)}
                  className="px-3 py-2 bg-blue-600 text-white rounded"
                >
                  Copy
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                Keep the private seed secure. This is shown only once.
              </p>

              <button
                onClick={() => {
                  setShowModal(false);
                  router.push("/admin");
                }}
                className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Close & Return to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

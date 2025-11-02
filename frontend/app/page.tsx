"use client";

import React, { useState, useEffect, useRef } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import {
  setAllowed,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";
import toast, { Toaster } from "react-hot-toast";
import nacl from "tweetnacl";

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID;
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

interface Flight {
  id: string;
  owner: string;
  max_passengers: number;
  distance: number;
  src: string;
  dest: string;
  status: string;
  escrow_amount: number;
  passenger_count: number;
}

export default function FlyStellar() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"passenger" | "admin" | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "allFlights" | "myFlights">("search");

  // Search state
  const [searchSrc, setSearchSrc] = useState("");
  const [searchDest, setSearchDest] = useState("");
  const [flights, setFlights] = useState<Flight[]>([]);

  // Admin state
  const [flightPub, setFlightPub] = useState("");
  const [maxPassengers, setMaxPassengers] = useState("");
  const [distance, setDistance] = useState("");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");

  // Modal state for showing keys
  const [showModal, setShowModal] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState("");
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState("");

  // Background voice
  const [voiceOn, setVoiceOn] = useState(true);

  // Connect wallet with role selection
  const handleConnect = async (role: "passenger" | "admin") => {
    try {
      await setAllowed();
      const { address } = await getAddress();
      setPublicKey(address);
      setUserRole(role);
      toast.success(`Connected as ${role}!`);
    } catch (err) {
      toast.error("Failed to connect Freighter");
      console.error(err);
    }
  };

  // Disconnect wallet
  const handleDisconnect = () => {
    setPublicKey(null);
    setUserRole(null);
    setFlights([]);
    toast.success("Disconnected!");
  };

  // Generate Ed25519 seed + Stellar keypair
  const generateKeypair = () => {
    try {
      // 1) generate random 32-byte seed
      const seed = nacl.randomBytes(32); // Uint8Array(32)

      // 2) build a Stellar Keypair from raw ed25519 seed
      // StellarSdk.Keypair.fromRawEd25519Seed accepts Uint8Array/Buffer
      const kp = StellarSdk.Keypair.fromRawEd25519Seed(seed);

      // kp.publicKey() -> G...
      // kp.secret() -> S...
      const pub = kp.publicKey();
      const sec = kp.secret();

      setGeneratedPublicKey(pub);
      setGeneratedPrivateKey(sec);

      // Set into the admin flightPub (auto-fill and read-only)
      setFlightPub(pub);

      return { seed, pub, sec, kp };
    } catch (err) {
      console.error("Key generation failed:", err);
      toast.error("Failed to generate keypair");
      return null;
    }
  };

  // Create Flight (Admin)
  const handleCreateFlight = async () => {
    if (!publicKey) return toast.error("Connect wallet first!");
    if (!maxPassengers || !distance || !src || !dest) {
      return toast.error("Fill all fields!");
    }

    try {
      setLoading(true);

      // Ensure we have a generated keypair for the flight; generate if missing
      if (!generatedPublicKey || !generatedPrivateKey) {
        generateKeypair();
      }

      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      // Use auto-filled flightPub
      const flightAddress = new StellarSdk.Address(flightPub);

      const maxPass = StellarSdk.nativeToScVal(parseInt(maxPassengers), { type: "u32" });
      const dist = StellarSdk.nativeToScVal(parseInt(distance), { type: "i128" });
      const srcSymbol = StellarSdk.nativeToScVal(src, { type: "symbol" });
      const destSymbol = StellarSdk.nativeToScVal(dest, { type: "symbol" });

      console.log(CONTRACT_ID)

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "create_flight",
            args: [
              StellarSdk.nativeToScVal(flightAddress, { type: "bytes" }),      // BytesN<32>
              StellarSdk.nativeToScVal(maxPass, { type: "u32" }),          // u32
              StellarSdk.nativeToScVal(dist, { type: "i128" }),            // i128
              StellarSdk.nativeToScVal(srcSymbol, { type: "symbol" }),     // Symbol
              StellarSdk.nativeToScVal(destSymbol, { type: "symbol" }),
            ],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      console.log("Flight created:", result);
      toast.success("Flight created successfully!");

      // Reset form fields (keep generated key visible)
      // keep generatedPublicKey/generatedPrivateKey so modal can show them
      setMaxPassengers("");
      setDistance("");
      setSrc("");
      setDest("");

      // Show modal containing keys
      setShowModal(true);

      // Refresh all flights if on that tab
      if (activeTab === "allFlights") {
        handleGetAllFlights();
      }
    } catch (err: any) {
      console.error("Error creating flight:", err);
      toast.error(err?.message || "Failed to create flight");
    } finally {
      setLoading(false);
    }
  };

  // Get All Flights (Admin)
  const handleGetAllFlights = async () => {
    if (!publicKey) return;

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "get_flights_admin",
            args: [],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      toast.success("Flights loaded!");
    } catch (err: any) {
      console.error("Error getting all flights:", err);
      toast.error("Failed to load flights");
    } finally {
      setLoading(false);
    }
  };

  // Update Flight Status (Admin)
  const handleUpdateStatus = async (flightOwner: string, newStatus: "takeoff" | "cancelled") => {
    if (!publicKey) return toast.error("Connect wallet first!");

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      const flightAddress = new StellarSdk.Address(flightOwner);
      const statusSymbol = StellarSdk.nativeToScVal(newStatus, { type: "symbol" });

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "update_flight_status",
            args: [flightAddress.toScVal(), statusSymbol],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      console.log("Status updated:", result);
      toast.success(`Flight status updated to ${newStatus}!`);

      handleGetAllFlights();
    } catch (err: any) {
      console.error("Error updating status:", err);
      toast.error(err?.message || "Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  // Search Flights (Passenger)
  const handleSearchFlights = async () => {
    if (!searchSrc || !searchDest) {
      return toast.error("Enter source and destination!");
    }

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey!);

      const srcSymbol = StellarSdk.nativeToScVal(searchSrc, { type: "symbol" });
      const destSymbol = StellarSdk.nativeToScVal(searchDest, { type: "symbol" });

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "get_flights_search",
            args: [srcSymbol, destSymbol],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      toast.success("Search completed!");
    } catch (err: any) {
      console.error("Error searching flights:", err);
      toast.error("Failed to search flights");
      setFlights([]);
    } finally {
      setLoading(false);
    }
  };

  // Buy Ticket (Passenger)
  const handleBuyTicket = async (flightOwner: string) => {
    if (!publicKey) return toast.error("Connect wallet first!");

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      const flightAddress = new StellarSdk.Address(flightOwner);
      const passengerAddress = new StellarSdk.Address(publicKey);
      const details = StellarSdk.nativeToScVal("passenger_info", { type: "symbol" });

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "buy_ticket",
            args: [flightAddress.toScVal(), passengerAddress.toScVal(), details],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      console.log("Ticket purchased:", result);
      toast.success("Ticket purchased successfully!");

      handleSearchFlights();
    } catch (err: any) {
      console.error("Error buying ticket:", err);
      toast.error(err?.message || "Failed to purchase ticket");
    } finally {
      setLoading(false);
    }
  };

  // Cancel Ticket (Passenger)
  const handleCancelTicket = async (flightOwner: string) => {
    if (!publicKey) return toast.error("Connect wallet first!");

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      const flightAddress = new StellarSdk.Address(flightOwner);
      const passengerAddress = new StellarSdk.Address(publicKey);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "cancel_ticket",
            args: [flightAddress.toScVal(), passengerAddress.toScVal()],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      console.log("Ticket cancelled:", result);
      toast.success("Ticket cancelled! 90% refunded");

      handleGetMyFlights();
    } catch (err: any) {
      console.error("Error cancelling ticket:", err);
      toast.error(err?.message || "Failed to cancel ticket");
    } finally {
      setLoading(false);
    }
  };

  // Get My Flights (Passenger)
  const handleGetMyFlights = async () => {
    if (!publicKey) return;

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      const passengerAddress = new StellarSdk.Address(publicKey);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          StellarSdk.Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "get_flights_pass",
            args: [passengerAddress.toScVal()],
          })
        )
        .setTimeout(180)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(txSigned);

      toast.success("My flights loaded!");
    } catch (err: any) {
      console.error("Error getting my flights:", err);
      toast.error("Failed to fetch your flights");
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate keys when admin opens the Create Flight tab (so flightPub is auto-filled)
  useEffect(() => {
    if (activeTab === "search" && userRole === "admin" && publicKey) {
      // generate if we don't already have a generated key
      if (!generatedPublicKey || !generatedPrivateKey) {
        generateKeypair();
      } else {
        // ensure flightPub synced
        setFlightPub(generatedPublicKey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userRole, publicKey]);

  // Play background voice using Web Speech API — repeats a short message while voiceOn is true
  useEffect(() => {
    const audio = new Audio("/audio/background.mp3");
    audio.loop = true;
    audio.volume = 0.5;

    const startAudio = () => {
      if (voiceOn) audio.play();
    };

    document.addEventListener("click", startAudio, { once: true });

    return () => {
      audio.pause();
      audio.currentTime = 0;
      document.removeEventListener("click", startAudio);
    };
  }, [voiceOn]);




  useEffect(() => {
    if (activeTab === "myFlights" && publicKey && userRole === "passenger") {
      handleGetMyFlights();
    } else if (activeTab === "allFlights" && publicKey && userRole === "admin") {
      handleGetAllFlights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, publicKey, userRole]);

  // Helper to copy keys
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied!");
    } catch (err) {
      console.error("Copy failed:", err);
      toast.error("Copy failed");
    }
  };

  // Login Screen
  if (!publicKey || !userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 flex items-center justify-center p-8">
        <Toaster position="top-right" />

        <div className="max-w-md w-full">
          <div className="text-center mb-12">
            <h1 className="text-6xl font-bold text-white mb-4">✈️ FlyStellar</h1>
            <p className="text-blue-100 text-lg">Decentralized Flight Booking on Stellar</p>
          </div>

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Connect Wallet</h2>
            <p className="text-white/80 text-center mb-8">Choose your role to continue</p>

            <div className="space-y-4">
              <button
                onClick={() => handleConnect("passenger")}
                disabled={loading}
                className="w-full bg-white text-blue-900 font-semibold py-4 px-6 rounded-lg hover:bg-blue-50 transition disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">🧳</span>
                <span>Login as Passenger</span>
              </button>

              <button
                onClick={() => handleConnect("admin")}
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-4 px-6 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">👨‍✈️</span>
                <span>Login as Admin</span>
              </button>
            </div>

            <p className="text-white/60 text-sm text-center mt-6">
              Make sure Freighter wallet is installed and connected to Testnet
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Admin Dashboard
  if (userRole === "admin") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-8">
        <Toaster position="top-right" />

        <div className="max-w-6xl mx-auto">
          <header className="flex justify-between items-center mb-12">
            <div>
              <h1 className="text-5xl font-bold text-white mb-2">✈️ FlyStellar Admin</h1>
              <p className="text-blue-100">Manage flights and operations</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setVoiceOn((v) => !v)}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition"
                title={voiceOn ? "Mute background voice" : "Enable background voice"}
              >
                {voiceOn ? "🔊 Voice On" : "🔇 Voice Off"}
              </button>

              <button
                onClick={handleDisconnect}
                className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition"
              >
                Disconnect
              </button>
            </div>
          </header>

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-8 border border-white/20">
            <div className="text-white text-center">
              <p className="text-sm opacity-80">Admin Wallet</p>
              <p className="font-mono text-sm mt-1">
                {publicKey.slice(0, 12)}...{publicKey.slice(-12)}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mb-8">
            <button
              onClick={() => setActiveTab("allFlights")}
              className={`flex-1 py-3 px-6 rounded-lg font-semibold transition ${activeTab === "allFlights"
                ? "bg-white text-blue-900"
                : "bg-white/10 text-white hover:bg-white/20"
                }`}
            >
              📋 All Flights
            </button>
            <button
              onClick={() => setActiveTab("search")}
              className={`flex-1 py-3 px-6 rounded-lg font-semibold transition ${activeTab === "search"
                ? "bg-white text-blue-900"
                : "bg-white/10 text-white hover:bg-white/20"
                }`}
            >
              ➕ Create Flight
            </button>
          </div>

          {/* All Flights Tab */}
          {activeTab === "allFlights" && (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">All Flights</h2>
                <button
                  onClick={handleGetAllFlights}
                  disabled={loading}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Loading..." : "Refresh"}
                </button>
              </div>

              <div className="space-y-4">
                {flights.length === 0 ? (
                  <p className="text-white/60 text-center py-8">No flights available</p>
                ) : (
                  flights.map((flight, idx) => (
                    <div key={idx} className="bg-white/20 rounded-lg p-6 border border-white/30">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-white font-bold text-lg">
                          {flight.src} → {flight.dest}
                        </span>
                        <span className="text-blue-200 font-semibold">
                          {flight.distance} XLM
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm text-white/80 mb-4">
                        <span>Seats: {flight.passenger_count}/{flight.max_passengers}</span>
                        <span>Escrow: {flight.escrow_amount} XLM</span>
                        <span className="capitalize">Status: {flight.status}</span>
                        <span className="font-mono text-xs">ID: {flight.id.slice(0, 8)}...</span>
                      </div>

                      <div className="mb-3 p-3 bg-white/10 rounded-lg">
                        <p className="text-xs text-white/60 mb-1">Flight Owner Address:</p>
                        <p className="text-xs font-mono text-white break-all">{flight.owner}</p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => handleUpdateStatus(flight.owner, "takeoff")}
                          disabled={loading || flight.status === "takeoff"}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Mark Takeoff
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(flight.owner, "cancelled")}
                          disabled={loading || flight.status === "cancelled"}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel Flight
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Create Flight Tab */}
          {activeTab === "search" && (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
              <h2 className="text-2xl font-bold text-white mb-6">Create New Flight</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-white/80 text-sm mb-2">Flight Public Address (auto-generated)</label>
                  <input
                    type="text"
                    placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    value={flightPub}
                    onChange={(e) => setFlightPub(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                    readOnly // auto-set so make readonly
                  />
                  <p className="text-xs text-white/60 mt-2">A new keypair is generated automatically. The public key is auto-filled above. The private key will be shown after a successful transaction.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white/80 text-sm mb-2">Max Passengers</label>
                    <input
                      type="number"
                      placeholder="150"
                      value={maxPassengers}
                      onChange={(e) => setMaxPassengers(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                    />
                  </div>
                  <div>
                    <label className="block text-white/80 text-sm mb-2">Price per Ticket (XLM)</label>
                    <input
                      type="number"
                      placeholder="100"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white/80 text-sm mb-2">Source Airport</label>
                    <input
                      type="text"
                      placeholder="NYC"
                      value={src}
                      onChange={(e) => setSrc(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                    />
                  </div>
                  <div>
                    <label className="block text-white/80 text-sm mb-2">Destination Airport</label>
                    <input
                      type="text"
                      placeholder="LAX"
                      value={dest}
                      onChange={(e) => setDest(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
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
          )}
        </div>

        {/* Keys Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowModal(false)} />
            <div className="relative bg-white/95 rounded-xl p-6 max-w-lg w-full mx-4">
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
                Keep the private seed secure — it controls the flight account on Stellar. This value is shown only here.
              </p>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowModal(false);
                  }}
                  className="px-4 py-2 rounded bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Passenger Dashboard
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-8">
      <Toaster position="top-right" />

      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-5xl font-bold text-white mb-2">✈️ FlyStellar</h1>
            <p className="text-blue-100">Book your next flight on the blockchain</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setVoiceOn((v) => !v)}
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition"
            >
              {voiceOn ? "🔊 Voice On" : "🔇 Voice Off"}
            </button>

            <button
              onClick={handleDisconnect}
              className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition"
            >
              Disconnect
            </button>
          </div>
        </header>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-8 border border-white/20">
          <div className="text-white text-center">
            <p className="text-sm opacity-80">Passenger Wallet</p>
            <p className="font-mono text-sm mt-1">
              {publicKey.slice(0, 12)}...{publicKey.slice(-12)}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab("search")}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition ${activeTab === "search"
              ? "bg-white text-blue-900"
              : "bg-white/10 text-white hover:bg-white/20"
              }`}
          >
            🔍 Search Flights
          </button>
          <button
            onClick={() => setActiveTab("myFlights")}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition ${activeTab === "myFlights"
              ? "bg-white text-blue-900"
              : "bg-white/10 text-white hover:bg-white/20"
              }`}
          >
            🎫 My Flights
          </button>
        </div>

        {/* Search Flights Tab */}
        {activeTab === "search" && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white mb-6">Search Flights</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <input
                type="text"
                placeholder="From (e.g., NYC)"
                value={searchSrc}
                onChange={(e) => setSearchSrc(e.target.value.toUpperCase())}
                className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/60 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
              <input
                type="text"
                placeholder="To (e.g., LAX)"
                value={searchDest}
                onChange={(e) => setSearchDest(e.target.value.toUpperCase())}
                className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/60 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
            <button
              onClick={handleSearchFlights}
              disabled={loading}
              className="w-full bg-white text-blue-900 font-semibold py-3 px-6 rounded-lg hover:bg-blue-50 transition disabled:opacity-50 mb-6"
            >
              {loading ? "Searching..." : "Search Flights"}
            </button>

            {/* Flight Results */}
            <div className="space-y-4">
              {flights.length === 0 ? (
                <p className="text-white/60 text-center py-8">
                  No flights found. Try searching for a route!
                </p>
              ) : (
                flights.map((flight, idx) => (
                  <div
                    key={idx}
                    className="bg-white/20 rounded-lg p-6 border border-white/30"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-white font-bold text-lg">
                        {flight.src} → {flight.dest}
                      </span>
                      <span className="text-blue-200 font-semibold">
                        {flight.distance} XLM
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-white/80 mb-4">
                      <span>
                        Seats: {flight.passenger_count}/{flight.max_passengers}
                      </span>
                      <span className="capitalize">Status: {flight.status}</span>
                    </div>
                    <button
                      onClick={() => handleBuyTicket(flight.owner)}
                      disabled={
                        loading ||
                        flight.status !== "booking" ||
                        flight.passenger_count >= flight.max_passengers
                      }
                      className="w-full bg-green-500 text-white font-semibold py-2 rounded-lg hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {flight.status !== "booking"
                        ? `Flight ${flight.status}`
                        : flight.passenger_count >= flight.max_passengers
                          ? "Fully Booked"
                          : "Book Now"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* My Flights Tab */}
        {activeTab === "myFlights" && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">My Booked Flights</h2>
              <button
                onClick={handleGetMyFlights}
                disabled={loading}
                className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            <div className="space-y-4">
              {flights.length === 0 ? (
                <p className="text-white/60 text-center py-8">
                  You haven't booked any flights yet
                </p>
              ) : (
                flights.map((flight, idx) => (
                  <div
                    key={idx}
                    className="bg-white/20 rounded-lg p-6 border border-white/30"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-white font-bold text-lg">
                        {flight.src} → {flight.dest}
                      </span>
                      <span className="text-blue-200 font-semibold">
                        Paid: {flight.distance} XLM
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-white/80 mb-4">
                      <span className="capitalize">Status: {flight.status}</span>
                      <span>
                        Passengers: {flight.passenger_count}/{flight.max_passengers}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCancelTicket(flight.owner)}
                      disabled={loading || flight.status !== "booking"}
                      className="w-full bg-red-500 text-white font-semibold py-2 rounded-lg hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {flight.status !== "booking"
                        ? "Cannot Cancel"
                        : "Cancel Ticket (90% Refund)"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

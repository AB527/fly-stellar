"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID;
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

interface Flight {
  id: Uint8Array; // ✅ Changed to Uint8Array
  owner: Uint8Array; // ✅ Changed to Uint8Array
  max_passengers: number;
  distance: number;
  src: string;
  dest: string;
  status: string;
  escrow_amount: number;
  passenger_count: number;
}

export default function PassengerDashboard() {
  const router = useRouter();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    const key = sessionStorage.getItem("publicKey");
    const role = sessionStorage.getItem("userRole");

    if (!key || role !== "passenger") {
      router.push("/");
      return;
    }

    setPublicKey(key);
    handleGetMyFlights(key);
  }, []);

  const handleDisconnect = () => {
    sessionStorage.clear();
    router.push("/");
  };

  const handleGetMyFlights = async (key?: string) => {
    const walletKey = key || publicKey;
    if (!walletKey) return;

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(walletKey);

      const passengerAddress = StellarSdk.Address.fromString(walletKey);
      const contract = new StellarSdk.Contract(CONTRACT_ID!);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call("get_flights_pass", passengerAddress.toScVal()))
        .setTimeout(180)
        .build();

      // ✅ Use simulateTransaction for read operations
      const simulated = await server.simulateTransaction(tx);

      if (StellarRpc.Api.isSimulationError(simulated)) {
        console.error("Simulation error:", simulated);
        toast.error("Failed to load your flights");
        return;
      }

      // ✅ Decode returned data from simulation
      if (simulated.result?.retval) {
        try {
          const decoded = StellarSdk.scValToNative(simulated.result.retval);
          console.log("Raw decoded my flights:", decoded);

          // ✅ Keep the Uint8Array as is
          const flightsList = decoded.map((flight: any) => ({
            id: flight.id, // Keep as Uint8Array
            owner: flight.id, // Keep as Uint8Array
            max_passengers: flight.max_passengers,
            distance: flight.distance,
            src: flight.src,
            dest: flight.dest,
            status: flight.status,
            escrow_amount: flight.escrow_amount,
            passenger_count: flight.passenger_count,
          }));

          console.log("My flights loaded:", flightsList.length);
          setFlights(flightsList);
          toast.success(`Loaded ${flightsList.length} flight(s)`);
        } catch (e) {
          console.error("Decode error:", e);
          toast.error("Error decoding flight data");
        }
      } else {
        setFlights([]);
        toast("No flights booked yet");
      }
    } catch (err: any) {
      console.error("Error getting my flights:", err);
      toast.error("Failed to fetch your flights");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelTicket = async (flightId: Uint8Array) => {
    if (!publicKey) return;

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey);

      // ✅ Handle Uint8Array directly for flight ID
      let flightIdBytes: Uint8Array;
      
      if (flightId instanceof Uint8Array) {
        flightIdBytes = flightId;
      } else {
        console.error("Unexpected flightId type:", typeof flightId);
        toast.error("Invalid flight ID format");
        return;
      }

      console.log("Flight ID bytes length:", flightIdBytes.length); // Should be 32

      const flightIdScVal = StellarSdk.xdr.ScVal.scvBytes(flightIdBytes);
      const passengerAddress = StellarSdk.Address.fromString(publicKey);

      const contract = new StellarSdk.Contract(CONTRACT_ID!);

      let tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call("cancel_ticket", flightIdScVal, passengerAddress.toScVal())
        )
        .setTimeout(180)
        .build();

      // ✅ Simulate first
      console.log("Simulating cancel transaction...");
      const simulated = await server.simulateTransaction(tx);
      
      if (StellarRpc.Api.isSimulationError(simulated)) {
        console.error("Simulation error:", simulated);
        toast.error(`Simulation failed: ${simulated.error}`);
        return;
      }

      console.log("Simulation successful");

      // ✅ Assemble transaction with simulation results
      const assembled = StellarRpc.assembleTransaction(tx, simulated).build();
      
      // ✅ Sign the assembled transaction
      console.log("Signing transaction...");
      const { signedTxXdr } = await signTransaction(assembled.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const txSigned = StellarSdk.TransactionBuilder.fromXDR(
        signedTxXdr,
        NETWORK_PASSPHRASE
      );

      // ✅ Send transaction
      console.log("Sending transaction...");
      const response = await server.sendTransaction(txSigned);
      console.log("Send response:", response);

      // ✅ Wait for confirmation
      if (response.status === "PENDING") {
        toast("Transaction pending...");
        let getResponse = await server.getTransaction(response.hash);
        let attempts = 0;
        
        while (getResponse.status === "NOT_FOUND" && attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          getResponse = await server.getTransaction(response.hash);
          attempts++;
        }

        if (getResponse.status === "SUCCESS") {
          toast.success("Ticket cancelled! 90% refunded");
          await handleGetMyFlights(); // Refresh the list
        } else {
          console.error("Transaction result:", getResponse);
          toast.error(`Transaction ${getResponse.status}`);
        }
      } else if (response.status === "ERROR") {
        console.error("Transaction error:", response);
        toast.error("Transaction error - check console");
      } else if (response.status === "SUCCESS") {
        toast.success("Ticket cancelled! 90% refunded");
        await handleGetMyFlights();
      }
    } catch (err: any) {
      console.error("Error cancelling ticket:", err);
      toast.error(err?.message || "Failed to cancel ticket");
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-8">
      <Toaster position="top-right" />

      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-5xl font-bold text-white mb-2">✈️ FlyStellar</h1>
            <p className="text-blue-100">Book your next flight on the blockchain</p>
          </div>
          <button
            onClick={handleDisconnect}
            className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition"
          >
            Disconnect
          </button>
        </header>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-8 border border-white/20">
          <div className="text-white text-center">
            <p className="text-sm opacity-80">Passenger Wallet</p>
            <p className="font-mono text-sm mt-1">
              {publicKey.slice(0, 12)}...{publicKey.slice(-12)}
            </p>
          </div>
        </div>

        <div className="flex gap-4 mb-8">
          <Link
            href="/passenger/search"
            className="flex-1 py-3 px-6 rounded-lg font-semibold transition bg-white text-blue-900 text-center"
          >
            🔍 Search Flights
          </Link>
        </div>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">My Booked Flights</h2>
            <button
              onClick={() => handleGetMyFlights()}
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
                <div key={idx} className="bg-white/20 rounded-lg p-6 border border-white/30">
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
                  <div className="text-xs text-white/60 font-mono mb-4">
                    Flight ID: {Buffer.from(flight.id).toString('hex').slice(0, 16)}...
                  </div>
                  <button
                    onClick={() => handleCancelTicket(flight.id)}
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
      </div>
    </div>
  );
}
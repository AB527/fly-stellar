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

export default function SearchFlightsPage() {
  const router = useRouter();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchSrc, setSearchSrc] = useState("");
  const [searchDest, setSearchDest] = useState("");
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    const key = sessionStorage.getItem("publicKey");
    const role = sessionStorage.getItem("userRole");

    if (!key || role !== "passenger") {
      router.push("/");
      return;
    }

    setPublicKey(key);
  }, []);

  const handleSearchFlights = async () => {
    if (!searchSrc || !searchDest) {
      return toast.error("Enter source and destination!");
    }

    try {
      setLoading(true);
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(publicKey!);

      const srcScVal = StellarSdk.nativeToScVal(searchSrc, { type: "symbol" });
      const destScVal = StellarSdk.nativeToScVal(searchDest, { type: "symbol" });

      const contract = new StellarSdk.Contract(CONTRACT_ID!);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call("get_flights_search", srcScVal, destScVal))
        .setTimeout(180)
        .build();

      // ✅ Use simulateTransaction for read operations
      const simulated = await server.simulateTransaction(tx);

      if (StellarRpc.Api.isSimulationError(simulated)) {
        console.error("Simulation error:", simulated);
        toast.error("Failed to search flights");
        setFlights([]);
        return;
      }

      // ✅ Decode returned data from simulation
      if (simulated.result?.retval) {
        try {
          const decoded = StellarSdk.scValToNative(simulated.result.retval);
          console.log("Raw decoded search results:", decoded);

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

          console.log("Search results loaded:", flightsList.length);
          setFlights(flightsList);
          
          if (flightsList.length === 0) {
            toast("No flights found for this route");
          } else {
            toast.success(`Found ${flightsList.length} flight(s)`);
          }
        } catch (e) {
          console.error("Decode error:", e);
          toast.error("Error decoding flight data");
          setFlights([]);
        }
      } else {
        setFlights([]);
        toast("No flights found");
      }
    } catch (err: any) {
      console.error("Error searching flights:", err);
      toast.error("Failed to search flights");
      setFlights([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBuyTicket = async (flightId: Uint8Array) => {
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
      const details = StellarSdk.nativeToScVal("passenger_info", { type: "symbol" });

      const contract = new StellarSdk.Contract(CONTRACT_ID!);

      let tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "buy_ticket",
            flightIdScVal,
            passengerAddress.toScVal(),
            details
          )
        )
        .setTimeout(180)
        .build();

      // ✅ Simulate first
      console.log("Simulating buy ticket transaction...");
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
          toast.success("Ticket purchased successfully!");
          await handleSearchFlights(); // Refresh the search results
        } else {
          console.error("Transaction result:", getResponse);
          toast.error(`Transaction ${getResponse.status}`);
        }
      } else if (response.status === "ERROR") {
        console.error("Transaction error:", response);
        toast.error("Transaction error - check console");
      } else if (response.status === "SUCCESS") {
        toast.success("Ticket purchased successfully!");
        await handleSearchFlights();
      }
    } catch (err: any) {
      console.error("Error buying ticket:", err);
      toast.error(err?.message || "Failed to purchase ticket");
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-8">
      <Toaster position="top-right" />

      <div className="max-w-4xl mx-auto">
        <Link
          href="/passenger"
          className="mb-6 text-white/80 hover:text-white flex items-center gap-2 inline-flex"
        >
          ← Back to Dashboard
        </Link>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-6">Search Flights</h2>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <input
              type="text"
              placeholder="From (e.g., BOM)"
              value={searchSrc}
              onChange={(e) => setSearchSrc(e.target.value.toUpperCase())}
              className="px-4 py-3 rounded-lg bg-white/20 text-white placeholder-white/60 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
            />
            <input
              type="text"
              placeholder="To (e.g., NYC)"
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

          <div className="space-y-4">
            {flights.length === 0 ? (
              <p className="text-white/60 text-center py-8">
                No flights found. Try searching for a route!
              </p>
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
                  <div className="flex justify-between text-sm text-white/80 mb-4">
                    <span>
                      Seats: {flight.passenger_count}/{flight.max_passengers}
                    </span>
                    <span className="capitalize">Status: {flight.status}</span>
                  </div>
                  <div className="text-xs text-white/60 font-mono mb-4">
                    Flight ID: {Buffer.from(flight.id).toString('hex').slice(0, 16)}...
                  </div>
                  <button
                    onClick={() => handleBuyTicket(flight.id)}
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
      </div>
    </div>
  );
}
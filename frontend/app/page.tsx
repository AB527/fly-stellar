"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setAllowed, getAddress } from "@stellar/freighter-api";
import toast, { Toaster } from "react-hot-toast";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleConnect = async (role: "passenger" | "admin") => {
    try {
      setLoading(true);
      await setAllowed();
      const { address } = await getAddress();
      
      // Store in sessionStorage
      sessionStorage.setItem("publicKey", address);
      sessionStorage.setItem("userRole", role);
      
      toast.success(`Connected as ${role}!`);
      
      // Navigate to respective dashboard
      if (role === "admin") {
        router.push("/admin");
      } else {
        router.push("/passenger");
      }
    } catch (err) {
      toast.error("Failed to connect Freighter");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
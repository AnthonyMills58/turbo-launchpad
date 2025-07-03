"use client";
import { useState } from "react";
import { ethers } from "ethers";

export default function MobileDebug() {
  const [result, setResult] = useState("Pending...");

  const test = async () => {
    try {
      if (typeof window === "undefined" || !window.ethereum) {
        setResult("❌ No window.ethereum found");
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setResult("✅ Signer address: " + addr);

      const balance = await provider.getBalance(addr);
      console.log("💰 ETH Balance:", ethers.formatEther(balance));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(err);
      setResult("❌ Error: " + message);
    }
  };

  return (
    <div className="p-4 bg-black text-white rounded-xl">
      <p>Mobile Debug Result:</p>
      <p className="font-mono text-green-400">{result}</p>
      <button onClick={test} className="mt-4 p-2 bg-blue-600 rounded">
        Run Test
      </button>
    </div>
  );
}


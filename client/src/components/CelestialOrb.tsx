import React from "react";

interface CelestialOrbProps {
  size?: number;
  isPulsing?: boolean;
  isRinging?: boolean;
  isConnected?: boolean;
}

export const CelestialOrb: React.FC<CelestialOrbProps> = ({
  size = 110,
  isPulsing = false,
  isRinging = false,
  isConnected = false,
}) => {
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      {(isPulsing || isRinging) && (
        <>
          <div
            style={{
              position: "absolute",
              width: size * 1.55,
              height: size * 1.55,
              borderRadius: "50%",
              border: "1px solid #26262E",
              animation: "ringOrbital 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: size * 1.3,
              height: size * 1.3,
              borderRadius: "50%",
              border: "1px solid #3F3F46",
              animation: "ringOrbital 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite 0.7s",
              pointerEvents: "none",
            }}
          />
        </>
      )}

      <img
        src="/liquid-orb.jpg"
        alt="Wallet Avatar"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          zIndex: 2,
          filter: "grayscale(100%)",
          border: isConnected ? "2px solid #FFFFFF" : "1.5px solid #26262E",
          transition: "border-color 0.2s ease",
        }}
      />
    </div>
  );
};

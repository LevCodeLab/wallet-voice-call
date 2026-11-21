import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebRtcService } from "../webrtc.service";

describe("WebRtcService Unit Tests", () => {
  let webRtc: WebRtcService;
  let callbacks: any;

  beforeEach(() => {
    callbacks = {
      onOffer: vi.fn(),
      onAnswer: vi.fn(),
      onIceCandidate: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
    };
    webRtc = new WebRtcService(callbacks);
  });

  afterEach(() => {
    webRtc.cleanup();
    vi.restoreAllMocks();
  });

  it("handles microphone permission denial gracefully", async () => {
    const notAllowedError = new Error("Permission denied");
    notAllowedError.name = "NotAllowedError";

    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(notAllowedError),
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(webRtc.acquireMicrophone()).rejects.toThrow("Microphone permission was denied");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "Microphone permission was denied. Please allow microphone access to talk."
    );
  });

  it("handles missing audio device error", async () => {
    const notFoundError = new Error("No device");
    notFoundError.name = "NotFoundError";

    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(notFoundError),
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(webRtc.acquireMicrophone()).rejects.toThrow("No audio input device");
    expect(callbacks.onError).toHaveBeenCalledWith("No audio input device (microphone) found.");
  });

  it("toggles microphone mute state on active stream", async () => {
    const mockTrack = { enabled: true, stop: vi.fn(), kind: "audio" };
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      },
      configurable: true,
      writable: true,
    });

    await webRtc.acquireMicrophone();
    expect(webRtc.getIsMuted()).toBe(false);

    // Mute
    const isMuted = webRtc.toggleMute();
    expect(isMuted).toBe(true);
    expect(mockTrack.enabled).toBe(false);

    // Unmute
    const isUnmuted = webRtc.toggleMute();
    expect(isUnmuted).toBe(false);
    expect(mockTrack.enabled).toBe(true);
  });

  it("toggles speaker audio output mute", () => {
    const mockAudioElement = {
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      srcObject: null,
    } as any;

    webRtc.setAudioElement(mockAudioElement);
    expect(webRtc.getIsSpeakerMuted()).toBe(false);

    const isMuted = webRtc.toggleSpeaker();
    expect(isMuted).toBe(true);
    expect(mockAudioElement.muted).toBe(true);

    const isUnmuted = webRtc.toggleSpeaker();
    expect(isUnmuted).toBe(false);
    expect(mockAudioElement.muted).toBe(false);
  });

  it("releases tracks and closes connection on cleanup", async () => {
    const mockTrack = { enabled: true, stop: vi.fn(), kind: "audio" };
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      },
      configurable: true,
      writable: true,
    });

    await webRtc.acquireMicrophone();
    webRtc.cleanup();

    expect(mockTrack.stop).toHaveBeenCalled();
  });
});

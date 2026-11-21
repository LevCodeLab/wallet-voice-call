/**
 * wallet-voice-call WebRTC Voice Calling Service
 * Manages browser-to-browser RTCPeerConnection and audio stream transport.
 */

export interface WebRtcCallbacks {
  onOffer: (sdp: string) => void;
  onAnswer: (sdp: string) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onConnected?: () => void;
  onError: (error: string) => void;
}

export class WebRtcService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private callbacks: WebRtcCallbacks;
  private isMuted: boolean = false;
  private isSpeakerMuted: boolean = false;
  private queuedCandidates: RTCIceCandidateInit[] = [];

  private iceServers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  constructor(callbacks: WebRtcCallbacks) {
    this.callbacks = callbacks;
  }

  public setAudioElement(element: HTMLAudioElement) {
    this.remoteAudioElement = element;
  }

  public setIceServers(servers: RTCIceServer[]): void {
    if (servers && servers.length > 0) {
      this.iceServers = servers;
    }
  }

  /**
   * Acquire microphone audio stream from browser.
   */
  public async acquireMicrophone(): Promise<MediaStream> {
    if (this.localStream) {
      return this.localStream;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is not supported in this browser environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localStream = stream;
      this.isMuted = false;
      return stream;
    } catch (err: any) {
      let message = "Could not access microphone.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        message = "Microphone permission was denied. Please allow microphone access to talk.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        message = "No audio input device (microphone) found.";
      } else if (err.name === "NotReadableError") {
        message = "Microphone is already in use by another application.";
      } else if (err.message) {
        message = err.message;
      }
      this.callbacks.onError(message);
      throw new Error(message);
    }
  }

  /**
   * Initialize RTCPeerConnection and attach local audio tracks.
   */
  private async initPeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const stream = await this.acquireMicrophone();

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });

    // Add local audio track
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Handle remote track
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && this.remoteAudioElement) {
        this.remoteAudioElement.srcObject = remoteStream;
        this.remoteAudioElement.play().catch((err) => {
          console.warn("Autoplay audio playback failed:", err);
        });
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange(pc.connectionState);
      if (pc.connectionState === "connected") {
        this.callbacks.onConnected?.();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        pc.restartIce();
      }
    };

    this.peerConnection = pc;
    return pc;
  }

  private async drainQueuedCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.queuedCandidates.length > 0) {
      const candidate = this.queuedCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("Failed to drain queued ICE candidate:", err);
        }
      }
    }
  }

  /**
   * Caller role: Create and send SDP offer.
   */
  public async createOffer(): Promise<void> {
    try {
      const pc = await this.initPeerConnection();
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
      });
      await pc.setLocalDescription(offer);

      if (pc.localDescription?.sdp) {
        this.callbacks.onOffer(pc.localDescription.sdp);
      }
    } catch (err: any) {
      this.callbacks.onError(`Failed to create WebRTC offer: ${err.message}`);
    }
  }

  /**
   * Recipient role: Process caller's SDP offer and generate SDP answer.
   */
  public async handleRemoteOffer(sdp: string): Promise<void> {
    try {
      const pc = await this.initPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      await this.drainQueuedCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (pc.localDescription?.sdp) {
        this.callbacks.onAnswer(pc.localDescription.sdp);
      }
    } catch (err: any) {
      this.callbacks.onError(`Failed to handle remote offer: ${err.message}`);
    }
  }

  /**
   * Caller role: Process recipient's SDP answer.
   */
  public async handleRemoteAnswer(sdp: string): Promise<void> {
    try {
      if (!this.peerConnection) return;
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp })
      );
      await this.drainQueuedCandidates();
    } catch (err: any) {
      this.callbacks.onError(`Failed to handle remote answer: ${err.message}`);
    }
  }

  /**
   * Both roles: Add remote ICE candidate (or queue if remote description is not set yet).
   */
  public async handleRemoteCandidate(candidateInit: RTCIceCandidateInit): Promise<void> {
    try {
      if (!this.peerConnection || !this.peerConnection.remoteDescription) {
        this.queuedCandidates.push(candidateInit);
        return;
      }
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err: any) {
      console.warn("Failed to add remote ICE candidate:", err);
    }
  }

  /**
   * Trigger ICE restart for media reconnection (Phase 5.2 Priority 3).
   */
  public async restartIceNegotiation(isCaller: boolean): Promise<void> {
    if (!this.peerConnection) return;
    try {
      if (isCaller) {
        const offer = await this.peerConnection.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
        });
        await this.peerConnection.setLocalDescription(offer);
        if (this.peerConnection.localDescription?.sdp) {
          this.callbacks.onOffer(this.peerConnection.localDescription.sdp);
        }
      } else {
        this.peerConnection.restartIce();
      }
    } catch (err: any) {
      console.warn("ICE restart negotiation failed:", err);
    }
  }

  /**
   * Toggle local microphone mute state.
   */
  public toggleMute(): boolean {
    if (!this.localStream) return this.isMuted;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Toggle speaker audio mute.
   */
  public toggleSpeaker(): boolean {
    if (!this.remoteAudioElement) return this.isSpeakerMuted;
    this.isSpeakerMuted = !this.isSpeakerMuted;
    this.remoteAudioElement.muted = this.isSpeakerMuted;
    return this.isSpeakerMuted;
  }

  public getIsSpeakerMuted(): boolean {
    return this.isSpeakerMuted;
  }

  /**
   * Teardown and release all media resources immediately.
   */
  public cleanup(): void {
    this.queuedCandidates = [];

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.localStream = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }

    if (this.remoteAudioElement) {
      this.remoteAudioElement.srcObject = null;
    }

    this.isMuted = false;
    this.isSpeakerMuted = false;
  }
}

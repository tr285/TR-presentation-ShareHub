export function getRTCConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ],
    },
  ];

  // Optional custom STUN servers from env
  const customStun = process.env.NEXT_PUBLIC_STUN_SERVERS;
  if (customStun) {
    const urls = customStun.split(",").map((s) => s.trim()).filter(Boolean);
    if (urls.length > 0) {
      iceServers.push({ urls });
    }
  }

  // Optional TURN servers from env
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl.split(",").map((s) => s.trim()).filter(Boolean),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

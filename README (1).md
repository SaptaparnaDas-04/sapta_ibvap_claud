# Border Vision AI

Problem Statement Title

AI-Based Intelligent Video Analytics Platform for Border Surveillance using existing CCTV Infrastructure.

Description

• Background Border security forces deploy CCTV cameras at Border Out Posts(BOPs), check posts, border roads, and other strategic locations for surveillance and monitoring. However, conventional CCTV systems primarily provide video recording and live monitoring capabilities,requiring continuous human observation. Advanced surveillance functionalities such as Facial Recognition Systems (FRS), Automatic Number Plate Recognition (ANPR), intrusion detection, and object tracking often require specialized hardware and proprietary solutions,making large-scale deployment costly and difficult, particularly in remote border areas.
• Description The proposed solution aims to develop an AI-driven software platform capable of transforming existing CCTV infrastructure into an intelligent surveillance network without requiring dedicated FRS, ANPR, or smart-camera hardware. The platform shall ingest live video streams from standard IP-based CCTV cameras and perform real-time video analytics using Artificial Intelligence and Computer Vision techniques.

The solution should provide capabilities such as:

• Human detection and tracking
• Vehicle detection and classification
• Face detection
• Automatic Number Plate Recognition (ANPR)
• Virtual fence intrusion detection
• Suspicious activity detection
• Night-time movement detection
• Real-time alert generation and event logging
• Expected Solution The proposed system should leverage Artificial Intelligence, Machine Learning, Computer Vision, and Video Analytics to create a software-defined surveillance platform capable of extracting actionable intelligence from existing CCTV infrastructure.

The solution should:

• Eliminate dependence on expensive dedicated surveillance hardware.
• Enable intelligent monitoring through AI-powered video analytics.
• Provide real-time alerts for security incidents and border intrusions.
• Support facial recognition, vehicle identification, and behavioral analytics through software.
• Improve situational awareness and response time for border security forces.
• Support integration with existing command and control systems.
• The final solution should be cost-effective, scalable, and suitable for deployment across remote border locations and strategic installations.
• Possible Project Name IBVAP â€“ Intelligent Border Video Analytics Platform

create website for this include reactjs, nodejs, opencv, superbase, phone acts as cctv, live video from phone goes to laptop, then real time processing with low latency

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://smart-border-guard.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2f96794d-cd47-4237-8661-6525d50eaff6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Running the phone → laptop live relay

The Live Analytics page (`/live`) can show a phone's camera live on the
laptop, not just analyze it on the phone. This needs one extra process:

```bash
cd signaling-server
npm install
npm start
```

Leave that running, then `npm run dev -- --host` as usual. On the laptop,
open `/live`, pick **Phone → laptop** as the source, and press **Start**.
Scan the QR / open the link on the phone — its camera streams directly to
the laptop's browser (true peer-to-peer video; the signaling server only
helps the two devices find each other, it never sees the video). Both
devices need to be on the same Wi-Fi/LAN — there's no TURN server
configured, so it won't work across separate networks (e.g. phone on
mobile data while the laptop is on a different Wi-Fi).

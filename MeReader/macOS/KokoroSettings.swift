import SwiftUI
import AVFoundation

/// Mac Settings: the Kokoro voice and the background audio preparation.
struct KokoroSettingsSection: View {
    @ObservedObject private var renderer = AudioRenderer.shared
    @ObservedObject private var downloader = KokoroDownloader.shared
    @EnvironmentObject var app: AppModel
    @State private var previewing: String?
    @State private var player: AVAudioPlayer?

    var body: some View {
        Section {
            if !downloader.installed {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Download the Kokoro voice (330 MB) to prepare natural-sounding audio.")
                    if let p = downloader.progress {
                        ProgressView(value: p)
                        Button("Cancel") { downloader.cancel() }
                    } else {
                        Button("Download Kokoro voice") { downloader.start() }.buttonStyle(.borderedProminent)
                    }
                    if let e = downloader.error { Text(e).font(.caption).foregroundStyle(.red) }
                }
            } else {
                Toggle("Prepare audio in the background", isOn: $renderer.enabled)
                Toggle("Open MeReader when you log in", isOn: $renderer.openAtLogin)
                Picker("Keep ready ahead", selection: $renderer.hoursAhead) {
                    Text("2 hours").tag(2.0)
                    Text("6 hours").tag(6.0)
                    Text("12 hours").tag(12.0)
                    Text("24 hours").tag(24.0)
                }
                status
                DisclosureGroup("Voice: \(KokoroEngine.voices.first { $0.id == renderer.voice }?.name ?? renderer.voice)") {
                    ForEach(KokoroEngine.voices, id: \.id) { v in
                        HStack {
                            Button { renderer.voice = v.id } label: {
                                HStack {
                                    Image(systemName: renderer.voice == v.id ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(Color.accentColor)
                                    VStack(alignment: .leading) {
                                        Text(v.name)
                                        Text(v.detail).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Button { preview(v.id) } label: {
                                if previewing == v.id { ProgressView().controlSize(.small) } else { Image(systemName: "play.circle") }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
        } header: {
            Text("Kokoro neural voice")
        } footer: {
            Text("While your Mac is on, MeReader prepares the next chapters of your books with Kokoro and puts them in iCloud Drive › Narrate › Audio. Your iPhone copies them ahead of time and plays them, screen off, in the car. Chapters that aren't ready yet use the voice below. Changing the voice re-prepares upcoming chapters.")
        }
    }

    @ViewBuilder private var status: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let w = renderer.current {
                HStack {
                    LiveBars(active: true).frame(width: 16, height: 12)
                    Text("Preparing \(w.title), chapter \(w.chapter + 1)…").font(.callout)
                }
                ProgressView(value: w.fraction)
            }
            ForEach(app.library.books.filter { renderer.ready[$0.id] != nil }, id: \.id) { book in
                let r = renderer.ready[book.id]!
                Text("\(book.title): \(r.chapters) chapter\(r.chapters == 1 ? "" : "s") ready ahead (\(String(format: "%.1f", r.hours)) h)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let e = renderer.error { Text(e).font(.caption).foregroundStyle(Palette.warn) }
        }
    }

    private func preview(_ voice: String) {
        previewing = voice
        KokoroEngine.shared.preview(voice: voice) { samples in
            DispatchQueue.main.async {
                previewing = nil
                guard let samples, let url = Self.wav(samples) else { return }
                player = try? AVAudioPlayer(contentsOf: url)
                player?.play()
            }
        }
    }

    private static func wav(_ samples: [Float]) -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("kokoro-preview.caf")
        let fmt = AVAudioFormat(standardFormatWithSampleRate: KokoroEngine.sampleRate, channels: 1)!
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(samples.count)) else { return nil }
        buf.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        try? FileManager.default.removeItem(at: url)
        guard let file = try? AVAudioFile(forWriting: url, settings: fmt.settings) else { return nil }
        try? file.write(from: buf)
        file.close()
        return url
    }
}

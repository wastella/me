import SwiftUI
import AVFoundation

struct SettingsView: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var narrator: Narrator
    @EnvironmentObject var progress: ProgressStore
    @Environment(\.dismiss) private var dismiss
    @State private var voices: [AVSpeechSynthesisVoice] = []
    @State private var useKokoro = RenderedAudio.enabled

    var body: some View {
        NavigationStack {
            Form {
                #if os(macOS)
                KokoroSettingsSection()
                #endif
                Section {
                    Toggle("Play audio prepared by your Mac", isOn: $useKokoro)
                        .onChange(of: useKokoro) { _, v in RenderedAudio.enabled = v }
                    #if os(iOS)
                    if let book = app.mostRecentBook {
                        let n = app.preparedChapters[book.id] ?? 0
                        Text(n > 0 ? "\(n) chapter\(n == 1 ? "" : "s") of \(book.title) ready on this iPhone."
                                   : "Nothing prepared on this iPhone yet. Open Narrate on your Mac; it prepares chapters in the background and they arrive here through iCloud.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    #endif
                } header: {
                    Text("Kokoro voice")
                } footer: {
                    Text("Prepared chapters use the natural Kokoro voice, also with the screen off. Anything not prepared yet is read by the system voice below.")
                }
                Section {
                    ForEach(voices.prefix(40), id: \.identifier) { v in
                        HStack {
                            Button {
                                narrator.voiceID = v.identifier
                            } label: {
                                HStack {
                                    Image(systemName: narrator.currentVoice()?.identifier == v.identifier ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(Color.accentColor)
                                    VStack(alignment: .leading) {
                                        Text(v.name)
                                        Text(languageName(v.language)).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    qualityBadge(v.quality)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Button { narrator.preview(voice: v) } label: { Image(systemName: "play.circle") }
                                .buttonStyle(.borderless)
                        }
                    }
                } header: {
                    Text("System voice")
                } footer: {
                    Text(voiceHelp)
                }

                Section {
                    HStack {
                        Text("Speed")
                        Spacer()
                        SpeedMenu()
                    }
                }

                #if os(iOS)
                if let expiry = AppExpiry.date {
                    Section {
                        LabeledContent("Works until", value: expiry.formatted(date: .abbreviated, time: .shortened))
                    } header: {
                        Text("App install")
                    } footer: {
                        Text("Free developer installs last 7 days. Your Mac reinstalls Narrate automatically every few days when the iPhone is on the same Wi‑Fi.")
                    }
                }
                Section {
                    Text("Narrate never starts on its own when you connect to the car. Press play on your phone, in Now Playing, or on the steering wheel, and it grabs your latest place from your other devices first.")
                        .font(.footnote)
                    Text("Hands-free: “Hey Siri, continue listening in Narrate”.").font(.footnote).foregroundStyle(.secondary)
                } header: {
                    Text("In the car")
                }
                #endif

                Section {
                    SyncDetailView().padding(.vertical, 6)
                } header: {
                    Text("Sync between devices")
                } footer: {
                    Text(syncHelp)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .scrollContentBackground(.hidden)
            .background(Palette.bg)
            .onAppear {
                voices = Narrator.bestVoices()
            }
        }
        .preferredColorScheme(.dark)
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 600)
        #endif
    }

    private func languageName(_ code: String) -> String {
        Locale.current.localizedString(forIdentifier: code) ?? code
    }

    @ViewBuilder private func qualityBadge(_ q: AVSpeechSynthesisVoiceQuality) -> some View {
        switch q {
        case .premium: Text("Premium").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2).background(.green.opacity(0.2), in: Capsule())
        case .enhanced: Text("Enhanced").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2).background(.blue.opacity(0.2), in: Capsule())
        default: Text("Basic").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var voiceHelp: String {
        #if os(iOS)
        "For a much more natural narrator, download a Premium voice (free): Settings → Accessibility → Read & Speak (Spoken Content) → Voices → English, then pick one marked Premium, like Zoe, Ava or Evan. It will show up here."
        #else
        "For a much more natural narrator, download a Premium voice (free): System Settings → Accessibility → Read & Speak → System Voice → Manage Voices, then pick one marked Premium, like Zoe, Ava or Evan. It will show up here."
        #endif
    }

    private var syncHelp: String {
        #if os(iOS)
        "Uses the iCloud Drive › Narrate folder your Mac created. After connecting once, positions sync on their own whenever you pause, switch apps, or open Narrate, and books you add on one device appear on the other."
        #else
        "Your Mac uses iCloud Drive › Narrate automatically. Positions sync on their own whenever you pause, switch apps, or open Narrate, and books you add on one device appear on the other."
        #endif
    }
}

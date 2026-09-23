import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('apple-foundation-models-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function FoundationModelsCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Since iOS 26, every iPhone that supports Apple Intelligence ships with a language model your
        app can call directly through the <Code>FoundationModels</Code> framework. It runs on the
        device, works offline, costs nothing per request, and user data never leaves the phone. For
        summaries, classification, tagging, short rewrites and extracting structured data from text,
        it is often good enough to replace a cloud API call.
      </p>
      <p>
        There is no official Capacitor plugin for it, and you do not need one. A local plugin inside
        your app is about sixty lines of Swift. This tutorial builds it, wires it to TypeScript, and
        covers what to do on devices that do not have the model.
      </p>

      <h2>When on-device AI is the right choice</h2>
      <DataTable
        headers={['Good fit on device', 'Better in the cloud']}
        rows={[
          ['Summarize a note, email or article', 'Long multi-step reasoning'],
          ['Classify or tag user content', 'Broad world knowledge and recent facts'],
          ['Extract fields from free text', 'Large documents or long conversations'],
          ['Suggest titles, replies, rewrites', 'Anything that must behave identically on every device'],
          ['Features that must work offline or stay private', 'Users on older or unsupported phones'],
        ]}
      />
      <p>
        The usual pattern is both: use the on-device model when it is available and the task is
        small, and fall back to your server otherwise.
      </p>

      <h2>1. Write the Swift plugin</h2>
      <p>
        Create <Code>ios/App/App/LocalAIPlugin.swift</Code> in your Capacitor project and add it to
        the App target in Xcode:
      </p>
      <Pre>{`import Capacitor
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(LocalAIPlugin)
public class LocalAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalAIPlugin"
    public let jsName = "LocalAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": String(describing: reason)])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "unsupportedOS"])
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt") else {
            call.reject("prompt is required")
            return
        }
        let instructions = call.getString("instructions") ?? ""

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let response = try await session.respond(to: prompt)
                    call.resolve(["text": response.content])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
            return
        }
        #endif
        call.reject("On-device model requires iOS 26 or later")
    }
}`}</Pre>
      <p>
        <Code>availability</Code> tells you why the model is missing: the device is not eligible,
        Apple Intelligence is turned off, or the model is still downloading. Pass that reason to
        JavaScript so the UI can respond sensibly.
      </p>

      <h2>2. Register the plugin</h2>
      <p>
        Local plugins are registered from a view controller. Create{' '}
        <Code>ios/App/App/MainViewController.swift</Code>:
      </p>
      <Pre>{`import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalAIPlugin())
    }
}`}</Pre>
      <p>
        Then open <Code>Main.storyboard</Code>, select the Bridge View Controller, and set its custom
        class to <Code>MainViewController</Code> in the Identity inspector.
      </p>

      <h2>3. The TypeScript bridge</h2>
      <Pre>{`// src/native/local-ai.ts
import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalAIPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  generate(options: { prompt: string; instructions?: string }): Promise<{ text: string }>;
}

const LocalAI = registerPlugin<LocalAIPlugin>('LocalAI');

export async function canUseLocalAI() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  const { available } = await LocalAI.isAvailable();
  return available;
}

export async function summarize(text: string) {
  if (await canUseLocalAI()) {
    const { text: summary } = await LocalAI.generate({
      instructions: 'Summarize the user text in two short sentences. Plain language, no preamble.',
      prompt: text,
    });
    return summary;
  }
  // Fallback: your server-side model
  const res = await fetch('/api/summarize', { method: 'POST', body: JSON.stringify({ text }) });
  return (await res.json()).summary as string;
}`}</Pre>
      <p>Call it like any other function:</p>
      <Pre>{`const summary = await summarize(note.body);`}</Pre>

      <h2>4. Things to know before shipping</h2>
      <ul>
        <li>
          <strong>Keep prompts short.</strong> The on-device model has a much smaller context window
          than cloud models. Summarize a note, not a book.
        </li>
        <li>
          <strong>Write instructions carefully.</strong> Small models follow clear, specific
          instructions far better than open-ended ones. Say what format you want and how long.
        </li>
        <li>
          <strong>Handle errors.</strong> Requests can fail for content policy reasons or when the
          context is exceeded. Always have a fallback path.
        </li>
        <li>
          <strong>Test on real hardware.</strong> Model availability depends on the device and the
          user&apos;s Apple Intelligence settings, which the simulator only partly reflects.
        </li>
        <li>
          <strong>Structured output</strong> is supported by the framework through Swift types
          marked <Code>@Generable</Code>. Once plain text works, it is the natural next step for
          extraction tasks.
        </li>
      </ul>

      <h2>What about Android?</h2>
      <p>
        Google offers on-device generation with Gemini Nano on supported Android devices through its
        ML Kit GenAI APIs. The structure is the same: a small Kotlin plugin with{' '}
        <Code>isAvailable</Code> and <Code>generate</Code>, registered in{' '}
        <Code>MainActivity</Code>. Because both plugins expose the same TypeScript interface, the
        rest of your app does not need to know which model answered.
      </p>

      <Callout>
        <p>
          <strong>The part you will change most is not native.</strong> The plugin is written once.
          The instructions, the prompt format, when to use local versus cloud, and how the result is
          shown all live in TypeScript. Expect to tune them for weeks after launch.
        </p>
      </Callout>

      <h2>Tune prompts without a store release</h2>
      <p>
        Prompt engineering is iterative. A slightly different instruction can turn a mediocre summary
        into a great one, and you only find out with real user content. If every tweak needs App
        Review, you get a few iterations a month.
      </p>
      <p>
        With <A href="/">OtaKit</A>, the plugin ships once in a store build, and every prompt change
        after that is a web update your users get on their next launch. Test new instructions on a
        staging channel first, then roll them out to everyone. For more on building AI features with
        Capacitor, see <A href="/blog/capacitor-ai-mobile-apps">Capacitor for AI mobile apps</A>.
      </p>
    </BlogArticle>
  );
}

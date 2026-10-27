import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Accordion } from "@base-ui/react/accordion";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import { useTheme } from "./useTheme";
import type { Theme } from "./useTheme";

const sourceUrl = "https://github.com/immiProgrammer/pix-forge";
const releasesUrl = `${sourceUrl}/releases/latest`;
const questions = [
  [
    "Which formats can I use?",
    "Export WebP, AVIF, JPG, JPEG, or PNG, or keep each source format. PixForge supports still images and flags animated files because animation preservation is not supported.",
  ],
  [
    "Will it change my original files?",
    "No. PixForge saves output files to your chosen destination. It checks for attempts to overwrite source files before exporting.",
  ],
  [
    "Does it work offline?",
    "Yes. The desktop app processes images locally. AI naming is optional: copy a text prompt to a separate tool and paste its response back. PixForge does not upload images.",
  ],
  [
    "What happens to my folders?",
    "PixForge recreates imported subfolders in the output folder. When you import several roots, it keeps their folder names and lets you resolve duplicate paths before export.",
  ],
  [
    "Can I use it in a browser?",
    "The browser version has limited functionality and uses browser-based encoding. The Windows app provides Rust processing, native folder access, and the complete export workflow.",
  ],
];

function Brand() {
  return (
    <a className="brand" href="#" aria-label="PixForge home">
      <img src="/app-icon.svg" alt="" width="28" height="28" />
      <span>
        PixForge<span className="brand-dot">.</span>
      </span>
    </a>
  );
}

function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];
  return (
    <Menu.Root>
      <Menu.Trigger
        className="theme-button"
        aria-label={`Theme: ${theme}`}
        title="Change theme"
      >
        <Icon size={16} />
        <span>{options.find((option) => option.value === theme)?.label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={9}
          align="end"
          className="theme-positioner"
        >
          <Menu.Popup className="theme-menu" aria-label="Color theme">
            {options.map(({ value, icon: OptionIcon, label }) => (
              <Menu.Item
                key={value}
                className="theme-option"
                onClick={() => setTheme(value)}
              >
                <OptionIcon size={15} />
                {label}
                {theme === value && <Check size={14} className="theme-check" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Capture({
  name,
  alt,
  adaptive = false,
  priority = false,
}: {
  name: string;
  alt: string;
  adaptive?: boolean;
  priority?: boolean;
}) {
  return (
    <div className="screenshot-stage">
      <div className="screenshot-frame">
        <img
          className={adaptive ? "capture-dark" : undefined}
          src={`/screenshots/${name}.webp`}
          alt={alt}
          width="1442"
          height="1002"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
        {adaptive && (
          <img
            className="capture-light"
            src="/screenshots/light-fill.webp"
            alt={alt}
            width="1442"
            height="1002"
            loading={priority ? "eager" : "lazy"}
            decoding="async"
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useEffect(() => {
    const updateHeader = () => setHeaderScrolled(window.scrollY > 10);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header" data-scrolled={headerScrolled}>
        <div className="nav-inner container">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#workflow">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-actions">
            <ThemeMenu />
            <a
              className="button nav-download"
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
            >
              Get PixForge <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="container">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">
            <span className="live-dot" /> IMAGE TOOLS FOR WINDOWS
          </p>
          <h1 id="hero-title">
            Meet PixForge.
            <span>
              A whole folder of images.
              <br className="mobile-break" /> Ready for what’s next.
            </span>
          </h1>
          <div className="hero-actions">
            <a
              className="button primary"
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download for Windows <ArrowDownToLine size={16} />
            </a>
            <span className="hero-note">
              Local processing. No account needed.
            </span>
          </div>
          <div className="hero-showcase" id="features">
            <Capture
              name="dark-fill"
              adaptive
              priority
              alt="PixForge workspace with a grid of product images, editable filenames, and output settings"
            />
            <div className="showcase-copy">
              <h2>
                Your image folder, handled.
                <span>Convert, compress, and rename in one workspace.</span>
              </h2>
              <p>
                Prepare product photos, website assets, and portfolios without
                working through files one at a time.
              </p>
              <div className="feature-summary">
                <span className="small-label">In the workspace</span>
                <ul>
                  <li>Files and nested folders</li>
                  <li>Format, quality, and size controls</li>
                  <li>Batch naming with undo</li>
                  <li>Grid and list views</li>
                  <li>Light and dark themes</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="format-strip" aria-label="Supported output formats">
            <span className="small-label">
              One collection. Your choice of format.
            </span>
            <div>
              <span>WebP</span>
              <span>AVIF</span>
              <span>JPEG</span>
              <span>PNG</span>
            </div>
            <span className="small-label">Or keep the source format.</span>
          </div>
        </section>

        <section
          className="editorial-section"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          <div className="section-heading">
            <h2 id="workflow-title">
              <span className="section-number">01</span> From folder to output
            </h2>
            <div className="section-copy">
              <h3>
                Set it up once.<span>Apply it across the collection.</span>
              </h3>
              <p>
                Drop in files or folders, choose your settings, and export to a
                new destination. PixForge keeps the folder structure and leaves
                the originals unchanged.
              </p>
            </div>
          </div>
          <ol className="workflow-steps">
            <li>
              <span className="small-label">01 / IMPORT</span>
              <h3>Bring the folder.</h3>
              <p>
                Add individual images or nested folders. Add more whenever you
                need.
              </p>
            </li>
            <li>
              <span className="small-label">02 / PREPARE</span>
              <h3>Make the adjustments.</h3>
              <p>
                Choose a format, set quality and dimension limits, then get the
                filenames right.
              </p>
            </li>
            <li>
              <span className="small-label">03 / EXPORT</span>
              <h3>Save the finished files.</h3>
              <p>
                Choose a destination, resolve collisions, and see the total size
                reduction.
              </p>
            </li>
          </ol>
        </section>

        <section className="editorial-section" aria-labelledby="compare-title">
          <div className="section-heading">
            <h2 id="compare-title">
              <span className="section-number">02</span> See the difference
            </h2>
            <div className="section-copy">
              <h3>
                Check the actual output.<span>Before you export.</span>
              </h3>
              <p>
                Compare original and processed images side by side. Zoom into
                the details while adjusting quality and format, with real
                encoded sizes and reduction percentages.
              </p>
            </div>
          </div>
          <Capture
            name="compare-sides"
            alt="PixForge showing original and processed watch images side by side"
          />
          <div className="image-caption">
            <span>Side-by-side comparison</span>
            <span>Actual app screenshot</span>
          </div>
          <div className="secondary-showcase">
            <div className="showcase-copy">
              <h3>
                A closer look.<span>With everything aligned.</span>
              </h3>
              <p>
                Move the comparison divider to inspect compression. Shared zoom
                and panning keep both versions in the same view.
              </p>
              <a className="text-link" href="#download">
                Try it on your images <ArrowRight size={15} />
              </a>
            </div>
            <Capture
              name="compare-slider"
              alt="PixForge slider comparison zoomed into keyboard details with output dimensions and size reduction"
            />
          </div>
        </section>

        <section className="editorial-section" aria-labelledby="naming-title">
          <div className="section-heading">
            <h2 id="naming-title">
              <span className="section-number">03</span> Get the names right
            </h2>
            <div className="section-copy">
              <h3>
                Names that make sense.<span>Folders that stay organized.</span>
              </h3>
              <p>
                Use folder names, product names, or numbering. Find and replace
                with plain text or regex. Edit any filename directly and undo a
                batch change in one step.
              </p>
              <p className="secondary-paragraph">
                Prefer an AI tool for naming? Copy a prompt, then import its
                filename mapping. You review the changes before applying them.
              </p>
            </div>
          </div>
          <Capture
            name="list-view"
            alt="PixForge list view displaying editable filenames, dimensions, original sizes, and processed results"
          />
          <div className="image-caption">
            <span>Every file and its results, in list view</span>
            <span>Folder structure preserved on export</span>
          </div>
        </section>

        <section
          className="editorial-section local-section"
          aria-labelledby="local-title"
        >
          <div className="section-heading">
            <h2 id="local-title">
              Made for the desktop.
              <span className="heading-subtitle">Works offline.</span>
            </h2>
            <div className="section-copy">
              <h3>
                Process images on your computer.
                <span>Keep control of your files.</span>
              </h3>
              <p>
                Rust handles image processing locally. PixForge adjusts
                background work to your CPU and available memory, so you can
                work through collections without uploading them.
              </p>
              <div className="inline-links">
                <a
                  className="button secondary"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source <ArrowRight size={15} />
                </a>
                <a
                  className="text-link"
                  href={`${sourceUrl}/blob/HEAD/docs/WINDOWS-BUILD.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Build it yourself <ArrowRight size={15} />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section
          className="editorial-section faq-section"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <h2 id="faq-title">Common questions.</h2>
            <p className="heading-subtitle">A few things to know.</p>
          </div>
          <Accordion.Root className="faq-list" multiple={false}>
            {questions.map(([question, answer]) => (
              <Accordion.Item
                className="faq-item"
                key={question}
                value={question}
              >
                <Accordion.Header className="faq-question">
                  <Accordion.Trigger className="faq-trigger">
                    {question}
                    <Plus size={17} />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel className="faq-panel">
                  <p>{answer}</p>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </section>

        <section
          className="editorial-section download-section"
          id="download"
          aria-labelledby="download-title"
        >
          <div>
            <h2 id="download-title">Your next folder, sorted.</h2>
            <p className="heading-subtitle">Get PixForge for Windows.</p>
          </div>
          <div>
            <a
              className="button primary"
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download for Windows <ArrowDownToLine size={16} />
            </a>
            <p className="download-note">
              Windows x64 · EXE and MSI installers
            </p>
          </div>
        </section>
      </main>
      <footer className="site-footer container">
        <Brand />
        <span>Batch image tools for Windows.</span>
        <div>
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            GitHub <ArrowRight size={13} />
          </a>
          <a href="#">Back to top ↑</a>
        </div>
      </footer>
    </>
  );
}

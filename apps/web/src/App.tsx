import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Accordion } from "@base-ui/react/accordion";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Folder,
  FolderInput,
  Image,
  Layers3,
  Monitor,
  Moon,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useTheme } from "./useTheme";
import type { Theme } from "./useTheme";

const releasesUrl =
  "https://github.com/immiProgrammer/pix-forge/releases/latest";
const sourceUrl = "https://github.com/immiProgrammer/pix-forge";

const buildCommand = "pnpm install\npnpm dist:windows";
const features = [
  {
    icon: FolderInput,
    title: "Import images and folders",
    text: "Import individual files or nested folders. Add more images to the same session at any time.",
  },
  {
    icon: SlidersHorizontal,
    title: "Convert, compress, and resize",
    text: "Set the output format, quality, and maximum dimensions. Check the processed image before exporting.",
  },
  {
    icon: WandSparkles,
    title: "Rename files in batches",
    text: "Name files by folder or product, add numbering, or slugify existing names. Edit individual names and undo changes.",
  },
  {
    icon: Layers3,
    title: "Compare the results",
    text: "View the original and output side by side or with a slider. Zoom in and check file sizes and dimensions.",
  },
  {
    icon: Folder,
    title: "Preserve your folder structure",
    text: "Export to a separate folder while keeping subfolders intact. Choose how to handle duplicate names and existing files.",
  },
  {
    icon: Sparkles,
    title: "Use an AI tool for naming",
    text: "Copy a prompt into your preferred AI tool. Paste its filename mapping back into PixForge, review it, and apply the changes.",
  },
];
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
    "Yes. The desktop app processes images locally. AI naming is optional: you copy a text prompt to a separate tool and paste its response back. PixForge does not upload images.",
  ],
  [
    "What happens to my folders?",
    "PixForge recreates imported subfolders in the output folder. If you import several roots, it keeps their folder names and asks you to resolve duplicate paths before export.",
  ],
  [
    "Can I use it in a browser?",
    "Yes, with limited functionality and browser-based encoding. The Windows app provides Rust processing, native folder access, and the complete export workflow.",
  ],
];

function Brand() {
  return (
    <a className="brand" href="#" aria-label="PixForge home">
      <img src="/app-icon.svg" alt="" width="30" height="30" />
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
        <Icon size={17} />
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

function WorkspaceScreenshots() {
  return (
    <div className="workspace-screenshots" id="workspace">
      <div className="demo-label">
        <span className="live-dot" /> 01 / THE WORKSPACE
        <span className="demo-label-right">PixForge for Windows</span>
      </div>
      <figure className="app-screenshot workspace-capture">
        <img
          className="capture-light"
          src="/screenshots/light-fill.webp"
          alt="PixForge in light mode with a product photo grid and output settings"
          width="1442"
          height="1002"
          loading="lazy"
          decoding="async"
        />
        <img
          className="capture-dark"
          src="/screenshots/dark-fill.webp"
          alt="PixForge in dark mode with a product photo grid and output settings"
          width="1442"
          height="1002"
          loading="lazy"
          decoding="async"
        />
        <figcaption>
          <span>Convert, rename, and export from one workspace.</span>
          <span>Actual app screenshot</span>
        </figcaption>
      </figure>
    </div>
  );
}

function ComparisonScreenshots() {
  return (
    <section
      className="capture-section container"
      aria-labelledby="capture-title"
    >
      <div className="capture-heading">
        <span className="eyebrow">INSIDE PIXFORGE</span>
        <h2 id="capture-title">
          Inspect the image.
          <br />
          Check the result.
        </h2>
        <div className="capture-heading-note">
          <span className="capture-note-line" aria-hidden="true" />
          <p>
            Compare the actual encoded output. Get a closer look before you
            commit to export.
          </p>
        </div>
      </div>
      <div className="capture-grid">
        <figure className="app-screenshot">
          <img
            src="/screenshots/compare-sides.webp"
            alt="PixForge side-by-side comparison of original and processed watch details"
            width="1442"
            height="1002"
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span className="capture-number">01 / COMPARE</span>
            <strong>Side by side</strong>
            <span>Original and output in an aligned view.</span>
          </figcaption>
        </figure>
        <figure className="app-screenshot">
          <img
            src="/screenshots/compare-slider.webp"
            alt="PixForge slider comparison zoomed into keyboard details, showing dimensions and size reduction"
            width="1442"
            height="1002"
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span className="capture-number">02 / INSPECT</span>
            <strong>Slider comparison</strong>
            <span>Zoom in to inspect details and compression.</span>
          </figcaption>
        </figure>
        <figure className="app-screenshot capture-list">
          <img
            src="/screenshots/list-view.webp"
            alt="PixForge list view showing filenames, dimensions, original sizes, and processed results"
            width="1442"
            height="1002"
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span className="capture-number">03 / REVIEW</span>
            <strong>
              Every file,
              <br />
              in view.
            </strong>
            <span>
              Review filenames, dimensions, and results across the collection.
            </span>
            <span className="list-capture-detail">
              <Check size={14} /> Individual filename editing
            </span>
            <span className="list-capture-detail">
              <Check size={14} /> Original and processed sizes
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function DownloadSection() {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildCommand);
      setCopied(true);
      setCopyFailed(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopyFailed(true);
    }
  };
  return (
    <section className="download-section" id="download">
      <div className="download-content">
        <span className="eyebrow">
          <span className="live-dot" /> GET PIXFORGE
        </span>
        <h2>
          Prepare your images
          <br />
          for export.
        </h2>
        <p>
          Convert formats, reduce file sizes, and rename files.
          <br />
          Available for Windows.
        </p>
        {releasesUrl ? (
          <>
            <a
              className="button primary"
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Monitor size={17} /> Download for Windows{" "}
              <ArrowDownToLine size={17} />
            </a>
            <span className="download-note">
              Windows x64 · Choose EXE or MSI on the releases page
            </span>
          </>
        ) : (
          <>
            <a className="button primary" href="#build-from-source">
              <Code2 size={17} /> Build for Windows <ArrowRight size={17} />
            </a>
            <span className="download-note">
              Windows x64 · EXE & MSI installers
            </span>
          </>
        )}
      </div>
      <div className="download-card" id="build-from-source">
        <div className="download-card-top">
          <span className="download-app-icon">
            <img src="/app-icon.svg" alt="" width="46" height="46" />
          </span>
          <div>
            <h3>PixForge</h3>
            <p>Batch image converter</p>
          </div>
          <span className="platform-tag">
            <Monitor size={12} /> Windows
          </span>
        </div>
        <div className="download-card-detail">
          <span>Convert. Compress. Rename.</span>
          <span className="muted">One local workflow.</span>
        </div>
        <div className="source-block">
          <div>
            <span>Build from your cloned repository</span>
            <button
              className="copy-button"
              onClick={copy}
              aria-label={copied ? "Commands copied" : "Copy build commands"}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre>
            <code>{buildCommand}</code>
          </pre>
        </div>
        {copyFailed && (
          <p className="copy-error" role="status">
            Select the commands above to copy them.
          </p>
        )}
        <p className="build-requirements">
          Requires Node.js, pnpm, Rust, MSVC, and native codec dependencies.
          {sourceUrl && (
            <>
              {" "}
              <a
                href={`${sourceUrl.replace(/\/$/, "")}/blob/HEAD/docs/WINDOWS-BUILD.md`}
                target="_blank"
                rel="noreferrer"
              >
                Build guide <ArrowRight size={12} />
              </a>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

export default function App() {
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useEffect(() => {
    let scrolled = window.scrollY > 10;
    setHeaderScrolled(scrolled);
    const updateHeader = () => {
      const next = window.scrollY > 10;
      if (next !== scrolled) {
        scrolled = next;
        setHeaderScrolled(next);
      }
    };
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header" data-scrolled={headerScrolled}>
        <div className="nav-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#workflow">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-actions">
            <ThemeMenu />
            <a className="button nav-download" href="#download">
              Get PixForge <ArrowDownToLine size={14} />
            </a>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="hero container">
          <div className="hero-heading">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="live-dot" /> BATCH IMAGE CONVERTER FOR WINDOWS
              </span>
              <h1>
                Convert, compress,
                <br />
                <span className="headline-accent">and rename images.</span>
              </h1>
              <p>
                Prepare product photos, website assets, and image collections.
                <br className="desktop-break" /> Process entire folders locally
                and compare the results before export.
              </p>
              <div className="hero-actions">
                <a href="#download" className="button primary">
                  <ArrowDownToLine size={17} /> Get PixForge for Windows
                </a>
                <a href="#workflow" className="text-link">
                  See how it works <ArrowRight size={16} />
                </a>
              </div>
              <div className="hero-reassurance">
                <span>
                  <Check size={13} /> No account needed
                </span>
                <span>
                  <Check size={13} /> Works offline
                </span>
                <span>
                  <Check size={13} /> Originals stay untouched
                </span>
              </div>
            </div>
            <div className="hero-collection">
              <div className="collection-label">
                <Folder size={14} /> product-collection/
                <span>03 files</span>
              </div>
              <div
                className="collection-photos"
                aria-label="Example product photos"
              >
                <figure className="collection-photo photo-audio">
                  <img
                    src="/images/product-headphones.webp"
                    alt="Studio headphones on a yellow background"
                    width="1600"
                    height="1067"
                  />
                  <figcaption>headphones.jpg</figcaption>
                </figure>
                <figure className="collection-photo photo-skincare">
                  <img
                    src="/images/product-skincare.webp"
                    alt="Skincare product collection"
                    width="1600"
                    height="1067"
                  />
                  <figcaption>skincare.jpg</figcaption>
                </figure>
                <figure className="collection-photo photo-ceramic">
                  <img
                    src="/images/product-ceramic.webp"
                    alt="Ceramic coffee cup"
                    width="1600"
                    height="1067"
                  />
                  <figcaption>ceramic-cup.jpg</figcaption>
                </figure>
              </div>
              <p className="collection-caption">
                <span className="live-dot" /> For product photos, web assets,
                and portfolios.
              </p>
            </div>
          </div>
          <WorkspaceScreenshots />
        </section>
        <section className="format-strip" aria-label="Supported output formats">
          <div className="container">
            <span>
              OUTPUT FORMATS
              <br />
              <strong>CHOOSE PER BATCH.</strong>
            </span>
            <div className="format-wordmarks">
              <span>
                WebP<span className="format-mark">.webp</span>
              </span>
              <span>
                AVIF<span className="format-mark">.avif</span>
              </span>
              <span>
                JPEG<span className="format-mark">.jpg</span>
              </span>
              <span>
                PNG<span className="format-mark">.png</span>
              </span>
            </div>
            <span className="format-original">
              Or keep the
              <br />
              <strong>source format.</strong>
            </span>
          </div>
        </section>
        <section
          className="features-section container"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="feature-intro">
            <div>
              <span className="eyebrow">THE BATCH TOOLKIT</span>
              <h2 id="features-title">
                Everything your
                <br />
                <span>image folder needs.</span>
              </h2>
            </div>
            <p>
              Convert the collection, get the names right, and inspect the
              result. Keep your folders organized from the first import to the
              final export.
            </p>
          </div>
          <div className="feature-list">
            {features.map(({ icon: Icon, title, text }, index) => (
              <article className="feature" key={title}>
                <div className="feature-kicker">
                  <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                  <span className="feature-index" aria-hidden="true">
                    0{index + 1}
                  </span>
                </div>
                <div className="feature-content">
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <ComparisonScreenshots />
        <section className="workflow-section" id="workflow">
          <div className="container workflow-inner">
            <div className="workflow-intro">
              <span className="eyebrow">HOW IT WORKS</span>
              <h2>
                Import your images.
                <br />
                Set up the output.
              </h2>
              <p>
                Choose settings for the files you need to process.
                <br />
                Your original files stay unchanged.
              </p>
              <a href="#download" className="text-link">
                Get PixForge <ArrowRight size={16} />
              </a>
            </div>
            <ol className="steps">
              <li>
                <span className="step-number">01</span>
                <div>
                  <h3>Import files or folders</h3>
                  <p>
                    Add images or folders. Nested folders are scanned
                    automatically.
                  </p>
                </div>
                <FolderInput size={20} />
              </li>
              <li>
                <span className="step-number">02</span>
                <div>
                  <h3>Adjust and compare</h3>
                  <p>
                    Choose a format, quality, and size limit. Rename files and
                    inspect the processed results.
                  </p>
                </div>
                <Settings2 size={20} />
              </li>
              <li>
                <span className="step-number">03</span>
                <div>
                  <h3>Export the results</h3>
                  <p>
                    Choose an output folder, resolve any filename conflicts, and
                    export. Check the size reduction when the export finishes.
                  </p>
                </div>
                <ArrowDownToLine size={20} />
              </li>
            </ol>
          </div>
        </section>
        <section className="details-strip container">
          <div>
            <Zap size={19} />
            <span>
              Rust image processing
              <br />
              <strong>In a native desktop app.</strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={19} />
            <span>
              Local processing
              <br />
              <strong>No image uploads.</strong>
            </span>
          </div>
          <div>
            <Image size={19} />
            <span>
              Encoded previews
              <br />
              <strong>Check size and dimensions.</strong>
            </span>
          </div>
        </section>
        <section className="faq-section container" id="faq">
          <div>
            <span className="eyebrow">FAQ</span>
            <h2>
              Common
              <br />
              questions.
            </h2>
            <p>Formats, folders, and local processing.</p>
          </div>
          <Accordion.Root className="faq-list">
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
        <div className="container">
          <DownloadSection />
        </div>
      </main>
      <footer className="site-footer container">
        <Brand />
        <span>Batch image conversion for Windows.</span>
        <div>
          <a href="#features">Features</a>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              Source <ArrowRight size={12} />
            </a>
          )}
          <a href="#">
            Back to top <ArrowRight size={12} className="back-to-top" />
          </a>
        </div>
      </footer>
    </>
  );
}

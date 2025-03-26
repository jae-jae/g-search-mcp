import { chromium, devices, BrowserContextOptions, Browser } from "playwright";
import { SearchResponse, SearchResult, SearchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Fingerprint configuration interface
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

// Saved state file interface
interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

/**
 * Get the host machine's actual configuration
 * @param userLocale User specified locale (if any)
 * @returns Fingerprint configuration based on host machine
 */
function getHostMachineConfig(userLocale?: string): FingerprintConfig {
  // Get system locale
  const systemLocale = userLocale || process.env.LANG || "en-US";

  // Get system timezone
  // Node.js doesn't directly provide timezone info, but we can infer from offset
  const timezoneOffset = new Date().getTimezoneOffset();
  let timezoneId = "America/New_York"; // Default to New York timezone

  // Roughly infer timezone based on offset
  // Timezone offset is in minutes, difference from UTC, negative means east
  if (timezoneOffset <= -480 && timezoneOffset > -600) {
    // UTC+8 (China, Singapore, Hong Kong, etc.)
    timezoneId = "Asia/Shanghai";
  } else if (timezoneOffset <= -540) {
    // UTC+9 (Japan, Korea, etc.)
    timezoneId = "Asia/Tokyo";
  } else if (timezoneOffset <= -420 && timezoneOffset > -480) {
    // UTC+7 (Thailand, Vietnam, etc.)
    timezoneId = "Asia/Bangkok";
  } else if (timezoneOffset <= 0 && timezoneOffset > -60) {
    // UTC+0 (UK, etc.)
    timezoneId = "Europe/London";
  } else if (timezoneOffset <= 60 && timezoneOffset > 0) {
    // UTC-1 (Parts of Europe)
    timezoneId = "Europe/Berlin";
  } else if (timezoneOffset <= 300 && timezoneOffset > 240) {
    // UTC-5 (US East)
    timezoneId = "America/New_York";
  }

  // Detect system color scheme
  // Node.js can't directly get system color scheme, use reasonable default
  // Infer based on time: use dark mode at night, light mode during day
  const hour = new Date().getHours();
  const colorScheme =
    hour >= 19 || hour < 7 ? ("dark" as const) : ("light" as const);

  // Other settings use reasonable defaults
  const reducedMotion = "no-preference" as const; // Most users don't enable reduced animation
  const forcedColors = "none" as const; // Most users don't enable forced colors

  // Choose a suitable device name
  // Select browser based on OS
  const platform = os.platform();
  let deviceName = "Desktop Chrome"; // Default to Chrome

  if (platform === "darwin") {
    // macOS
    deviceName = "Desktop Safari";
  } else if (platform === "win32") {
    // Windows
    deviceName = "Desktop Edge";
  } else if (platform === "linux") {
    // Linux
    deviceName = "Desktop Firefox";
  }

  // We're using Chrome
  deviceName = "Desktop Chrome";

  return {
    deviceName,
    locale: systemLocale,
    timezoneId,
    colorScheme,
    reducedMotion,
    forcedColors,
  };
}

/**
 * Perform Google search and return results
 * @param query Search keyword
 * @param options Search options
 * @returns Search results
 */
export async function googleSearch(
  query: string,
  options: SearchOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  // Set default options
  const {
    limit = 10,
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "en-US", // Default to English
  } = options;

  // Always use headless mode unless debug is enabled
  let useHeadless = !options.debug;

  logger.info("[GoogleSearch] Initializing browser...");

  // Check if state file exists
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // Fingerprint file path
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      `[GoogleSearch] Found browser state file, will use saved browser state to avoid bot detection`
    );
    storageState = stateFile;

    // Try to load saved fingerprint configuration
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("[GoogleSearch] Loaded saved browser fingerprint configuration");
      } catch (e) {
        logger.warn("[GoogleSearch] Cannot load fingerprint file, will create new fingerprint");
      }
    }
  } else {
    logger.info(
      `[GoogleSearch] No browser state file found, will create new browser session and fingerprint`
    );
  }

  // Only use desktop device list
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // Timezone list
  const timezoneList = [
    "America/New_York",
    "Europe/London",
    "Asia/Shanghai",
    "Europe/Berlin",
    "Asia/Tokyo",
  ];

  // Google domain list
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  // Get random device config or use saved config
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // Use saved device config
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // Randomly select a device
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // Get random delay time
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // Define a function to perform search, can be reused for headless and non-headless
  async function performSearch(headless: boolean): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = false;

    if (existingBrowser) {
      browser = existingBrowser;
      browserWasProvided = true;
      logger.info("[GoogleSearch] Using existing browser instance");
    } else {
      logger.info(
        `[GoogleSearch] Preparing to launch browser in ${headless ? "headless" : "non-headless"} mode...`
      );

      // Initialize browser with more parameters to avoid detection
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2, // Increase browser launch timeout
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--disable-web-security",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--hide-scrollbars",
          "--mute-audio",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--disable-extensions",
          "--disable-features=TranslateUI",
          "--disable-ipc-flooding-protection",
          "--disable-renderer-backgrounding",
          "--enable-features=NetworkService,NetworkServiceInProcess",
          "--force-color-profile=srgb",
          "--metrics-recording-only",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });

      logger.info("[GoogleSearch] Browser launched successfully!");
    }

    // Get device config - use saved or randomly generate
    const [deviceName, deviceConfig] = getDeviceConfig();

    // Create browser context options
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // If we have saved fingerprint config, use it; otherwise use host machine's actual settings
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("[GoogleSearch] Using saved browser fingerprint configuration");
    } else {
      // Get host machine's actual settings
      const hostConfig = getHostMachineConfig(locale);

      // If we need to use a different device type, get device config again
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          `[GoogleSearch] Using device type based on host machine settings: ${hostConfig.deviceName}`
        );
        // Use new device config
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // Save new generated fingerprint config
      savedState.fingerprint = hostConfig;
      logger.info(
        `[GoogleSearch] Generated new browser fingerprint config based on host machine: locale=${hostConfig.locale}, timezone=${hostConfig.timezoneId}, colorScheme=${hostConfig.colorScheme}, deviceType=${hostConfig.deviceName}`
      );
    }

    // Add common options - ensure desktop configuration
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // Force desktop mode
      hasTouch: false, // Disable touch features
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("[GoogleSearch] Loading saved browser state...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );

    // Set additional browser properties to avoid detection
    await context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override window properties
      // @ts-ignore - ignore chrome property missing error
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // Add WebGL fingerprint randomization
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number
        ) {
          // Randomize UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // Set page additional properties
    await page.addInitScript(() => {
      // Simulate realistic screen dimensions and color depth
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // Use saved Google domain or randomly select one
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info(`[GoogleSearch] Using saved Google domain: ${selectedDomain}`);
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // Save selected domain
        savedState.googleDomain = selectedDomain;
        logger.info(`[GoogleSearch] Randomly selected Google domain: ${selectedDomain}`);
      }

      logger.info("[GoogleSearch] Visiting Google search page...");

      // Visit Google search page
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // Check if redirected to CAPTCHA page
      const currentUrl = page.url();
      const captchaPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = captchaPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern))
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn("[GoogleSearch] CAPTCHA detected, will restart browser in non-headless mode...");

          // Close current page and context
          await page.close();
          await context.close();

          // If it's an externally provided browser, don't close it but create a new browser instance
          if (browserWasProvided) {
            logger.warn(
              "[GoogleSearch] CAPTCHA detected with external browser instance, creating new browser instance..."
            );
            // Create a new browser instance, no longer use the externally provided one
            const newBrowser = await chromium.launch({
              headless: false, // Use non-headless mode
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // Other args same as original
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // Use new browser instance to perform search
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // Can add code to handle CAPTCHA here
              // ...

              // Close temp browser after completion
              await newBrowser.close();

              // Re-perform search
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // If not externally provided browser, close and re-perform search
            await browser.close();
            return performSearch(false); // Re-perform search in non-headless mode
          }
        } else {
          logger.warn("[GoogleSearch] CAPTCHA detected, please complete verification in browser...");
          // Wait for user to complete verification and redirect back to search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return captchaPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("[GoogleSearch] CAPTCHA verification completed, continuing with search...");
        }
      }

      logger.info(`[GoogleSearch] Entering search keyword: ${query}`);

      // Wait for search box to appear - try multiple possible selectors
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info(`[GoogleSearch] Found search box with selector: ${selector}`);
          break;
        }
      }

      if (!searchInput) {
        logger.error("[GoogleSearch] Could not find search box");
        throw new Error("Could not find search box");
      }

      // Click search box directly, reduce delay
      await searchInput.click();

      // Enter entire query string directly, not character by character
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // Reduce delay before pressing Enter
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("[GoogleSearch] Waiting for page to load...");

      // Wait for page to fully load
      await page.waitForLoadState("networkidle", { timeout });

      // Check if search URL redirected to CAPTCHA page
      const searchUrl = page.url();
      const isBlockedAfterSearch = captchaPatterns.some((pattern) =>
        searchUrl.includes(pattern)
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn(
            "[GoogleSearch] CAPTCHA detected after search, will restart browser in non-headless mode..."
          );

          // Close current page and context
          await page.close();
          await context.close();

          // If it's an externally provided browser, don't close it but create a new browser instance
          if (browserWasProvided) {
            logger.warn(
              "[GoogleSearch] CAPTCHA detected after search with external browser instance, creating new browser instance..."
            );
            // Create a new browser instance, no longer use the externally provided one
            const newBrowser = await chromium.launch({
              headless: false, // Use non-headless mode
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // Other args same as original
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // Use new browser instance to perform search
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // Can add code to handle CAPTCHA here
              // ...

              // Close temp browser after completion
              await newBrowser.close();

              // Re-perform search
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // If not externally provided browser, close and re-perform search
            await browser.close();
            return performSearch(false); // Re-perform search in non-headless mode
          }
        } else {
          logger.warn("[GoogleSearch] CAPTCHA detected after search, please complete verification in browser...");
          // Wait for user to complete verification and redirect back to search page
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return captchaPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("[GoogleSearch] CAPTCHA verification completed, continuing with search...");

          // Wait for page to reload
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      logger.info(`[GoogleSearch] Waiting for search results to load... URL: ${page.url()}`);

      // Try multiple possible search result selectors
      const searchResultSelectors = [
        "#search",
        "#rso",
        ".g",
        "[data-sokoban-container]",
        "div[role='main']",
      ];

      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: timeout / 2 });
          logger.info(`[GoogleSearch] Found search results with selector: ${selector}`);
          resultsFound = true;
          break;
        } catch (e) {
          // Try next selector
        }
      }

      if (!resultsFound) {
        // If can't find search results, check if redirected to CAPTCHA page
        const currentUrl = page.url();
        const isBlockedDuringResults = captchaPatterns.some((pattern) =>
          currentUrl.includes(pattern)
        );

        if (isBlockedDuringResults) {
          if (headless) {
            logger.warn(
              "[GoogleSearch] CAPTCHA detected while waiting for results, will restart browser in non-headless mode..."
            );

            // Close current page and context
            await page.close();
            await context.close();

            // If it's an externally provided browser, don't close it but create a new browser instance
            if (browserWasProvided) {
              logger.warn(
                "[GoogleSearch] CAPTCHA detected while waiting for results with external browser instance, creating new browser instance..."
              );
              // Create a new browser instance, no longer use the externally provided one
              const newBrowser = await chromium.launch({
                headless: false, // Use non-headless mode
                timeout: timeout * 2,
                args: [
                  "--disable-blink-features=AutomationControlled",
                  // Other args same as original
                  "--disable-features=IsolateOrigins,site-per-process",
                  "--disable-site-isolation-trials",
                  "--disable-web-security",
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                  "--disable-accelerated-2d-canvas",
                  "--no-first-run",
                  "--no-zygote",
                  "--disable-gpu",
                  "--hide-scrollbars",
                  "--mute-audio",
                  "--disable-background-networking",
                  "--disable-background-timer-throttling",
                  "--disable-backgrounding-occluded-windows",
                  "--disable-breakpad",
                  "--disable-component-extensions-with-background-pages",
                  "--disable-extensions",
                  "--disable-features=TranslateUI",
                  "--disable-ipc-flooding-protection",
                  "--disable-renderer-backgrounding",
                  "--enable-features=NetworkService,NetworkServiceInProcess",
                  "--force-color-profile=srgb",
                  "--metrics-recording-only",
                ],
                ignoreDefaultArgs: ["--enable-automation"],
              });

              // Use new browser instance to perform search
              try {
                const tempContext = await newBrowser.newContext(contextOptions);
                const tempPage = await tempContext.newPage();

                // Can add code to handle CAPTCHA here
                // ...

                // Close temp browser after completion
                await newBrowser.close();

                // Re-perform search
                return performSearch(false);
              } catch (error) {
                await newBrowser.close();
                throw error;
              }
            } else {
              // If not externally provided browser, close and re-perform search
              await browser.close();
              return performSearch(false); // Re-perform search in non-headless mode
            }
          } else {
            logger.warn(
              "[GoogleSearch] CAPTCHA detected while waiting for results, please complete verification in browser..."
            );
            // Wait for user to complete verification and redirect back to search page
            await page.waitForNavigation({
              timeout: timeout * 2,
              url: (url) => {
                const urlStr = url.toString();
                return captchaPatterns.every(
                  (pattern) => !urlStr.includes(pattern)
                );
              },
            });
            logger.info("[GoogleSearch] CAPTCHA verification completed, continuing with search...");

            // Try again to wait for search results
            for (const selector of searchResultSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: timeout / 2 });
                logger.info(`[GoogleSearch] Found search results after verification with selector: ${selector}`);
                resultsFound = true;
                break;
              } catch (e) {
                // Try next selector
              }
            }

            if (!resultsFound) {
              logger.error("[GoogleSearch] Could not find search result elements");
              throw new Error("Could not find search result elements");
            }
          }
        } else {
          // If not CAPTCHA issue, throw error
          logger.error("[GoogleSearch] Could not find search result elements");
          throw new Error("Could not find search result elements");
        }
      }

      // Reduce wait time
      await page.waitForTimeout(getRandomDelay(200, 500));

      logger.info("[GoogleSearch] Extracting search results...");

      // Extract search results - try multiple selector combinations
      const resultSelectors = [
        { container: "#search .g", title: "h3", snippet: ".VwiC3b" },
        { container: "#rso .g", title: "h3", snippet: ".VwiC3b" },
        { container: ".g", title: "h3", snippet: ".VwiC3b" },
        {
          container: "[data-sokoban-container] > div",
          title: "h3",
          snippet: "[data-sncf='1']",
        },
        {
          container: "div[role='main'] .g",
          title: "h3",
          snippet: "[data-sncf='1']",
        },
      ];

      let results: SearchResult[] = [];

      for (const selector of resultSelectors) {
        try {
          results = await page.$$eval(
            selector.container,
            (
              elements: Element[],
              params: {
                maxResults: number;
                titleSelector: string;
                snippetSelector: string;
              }
            ) => {
              return elements
                .slice(0, params.maxResults)
                .map((el: Element) => {
                  const titleElement = el.querySelector(params.titleSelector);
                  const linkElement = el.querySelector("a");
                  const snippetElement = el.querySelector(
                    params.snippetSelector
                  );

                  return {
                    title: titleElement ? titleElement.textContent || "" : "",
                    link:
                      linkElement && linkElement instanceof HTMLAnchorElement
                        ? linkElement.href
                        : "",
                    snippet: snippetElement
                      ? snippetElement.textContent || ""
                      : "",
                  };
                })
                .filter(
                  (item: { title: string; link: string; snippet: string }) =>
                    item.title && item.link
                ); // Filter out empty results
            },
            {
              maxResults: limit,
              titleSelector: selector.title,
              snippetSelector: selector.snippet,
            }
          );

          if (results.length > 0) {
            logger.info(`[GoogleSearch] Successfully extracted results with selector: ${selector.container}`);
            break;
          }
        } catch (e) {
          // Try next selector combination
        }
      }

      // If all selectors fail, try a more generic method
      if (results.length === 0) {
        logger.warn("[GoogleSearch] Using fallback method to extract search results...");
        results = await page.$$eval(
          "a[href^='http']",
          (elements: Element[], maxResults: number) => {
            return elements
              .filter((el: Element) => {
                // Filter out navigation links, image links, etc.
                const href = el.getAttribute("href") || "";
                return (
                  href.startsWith("http") &&
                  !href.includes("google.com/") &&
                  !href.includes("accounts.google") &&
                  !href.includes("support.google")
                );
              })
              .slice(0, maxResults)
              .map((el: Element) => {
                const title = el.textContent || "";
                const link =
                  el instanceof HTMLAnchorElement
                    ? el.href
                    : el.getAttribute("href") || "";
                // Try to get surrounding text as snippet
                let snippet = "";
                let parent = el.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                  const text = parent.textContent || "";
                  if (text.length > snippet.length && text !== title) {
                    snippet = text;
                  }
                  parent = parent.parentElement;
                }

                return { title, link, snippet };
              })
              .filter(
                (item: { title: string; link: string; snippet: string }) =>
                  item.title && item.link
              ); // Filter out empty results
          },
          limit
        );
      }

      logger.info(`[GoogleSearch] Successfully retrieved search results: ${results.length} items`);

      try {
        // Save browser state (unless user specified not to)
        if (!noSaveState) {
          logger.info(`[GoogleSearch] Saving browser state...`);

          // Ensure directory exists
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // Save state
          await context.storageState({ path: stateFile });
          logger.info("[GoogleSearch] Browser state saved successfully!");

          // Save fingerprint config
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info(`[GoogleSearch] Fingerprint configuration saved`);
          } catch (fingerprintError) {
            logger.error(`[GoogleSearch] Error saving fingerprint configuration: ${fingerprintError}`);
          }
        } else {
          logger.info("[GoogleSearch] Not saving browser state as per user setting");
        }
      } catch (error) {
        logger.error(`[GoogleSearch] Error saving browser state: ${error}`);
      }

      // Only close browser if it's not externally provided and not in debug mode
      if (!browserWasProvided && !options.debug) {
        logger.info("[GoogleSearch] Closing browser...");
        await browser.close();
      } else {
        logger.info("[GoogleSearch] Keeping browser instance open");
      }

      // Return search results
      return {
        query,
        results,
      };
    } catch (error) {
      logger.error(`[GoogleSearch] Error during search: ${error}`);

      try {
        // Try to save browser state even if error occurs
        if (!noSaveState) {
          logger.info(`[GoogleSearch] Saving browser state after error...`);
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // Save fingerprint config
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info(`[GoogleSearch] Fingerprint configuration saved after error`);
          } catch (fingerprintError) {
            logger.error(`[GoogleSearch] Error saving fingerprint configuration: ${fingerprintError}`);
          }
        }
      } catch (stateError) {
        logger.error(`[GoogleSearch] Error saving browser state: ${stateError}`);
      }

      // Only close browser if it's not externally provided and not in debug mode
      if (!browserWasProvided && !options.debug) {
        logger.info("[GoogleSearch] Closing browser...");
        await browser.close();
      } else {
        logger.info("[GoogleSearch] Keeping browser instance open");
      }

      // Create a mock search result to return some information even if error occurs
      return {
        query,
        results: [
          {
            title: "Search failed",
            link: "",
            snippet: `Unable to complete search, error message: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }

  // First try to execute search in headless mode
  return performSearch(useHeadless);
}

/**
 * Perform multiple Google searches in parallel
 * @param queries Array of search keywords
 * @param options Search options
 * @returns Array of search results for each query
 */
export async function multiGoogleSearch(
  queries: string[],
  options: SearchOptions = {}
): Promise<SearchResponse[]> {
  if (!queries || queries.length === 0) {
    throw new Error("At least one search query is required");
  }

  logger.info(`[MultiSearch] Starting multiple searches for ${queries.length} queries...`);
  
  // Launch a single browser instance for all searches
  const browser = await chromium.launch({
    headless: !options.debug,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-web-security",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-extensions",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
      "--disable-renderer-backgrounding",
      "--enable-features=NetworkService,NetworkServiceInProcess",
      "--force-color-profile=srgb",
      "--metrics-recording-only",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  try {
    // Create a unique state file for each query to avoid conflicts
    const searches = await Promise.all(
      queries.map((query, index) => {
        const searchOptions = {
          ...options,
          stateFile: options.stateFile 
            ? `${options.stateFile}-${index}`
            : `./browser-state-${index}.json`,
        };
        
        logger.info(`[MultiSearch] Starting search #${index + 1} for query: "${query}"`);
        return googleSearch(query, searchOptions, browser);
      })
    );

    logger.info(`[MultiSearch] All searches completed successfully`);
    return searches;
  } finally {
    // Only close browser if not in debug mode
    if (!options.debug) {
      logger.info(`[MultiSearch] Closing main browser instance`);
      await browser.close();
    } else {
      logger.info(`[MultiSearch] Keeping browser instance open for debug mode`);
    }
  }
} 
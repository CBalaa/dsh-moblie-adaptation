/**
 * dsh-mobile-adaptation — browser half (client bundle).
 *
 * A DeepSeek Harness client plugin bundle is a classic script that registers
 * itself through `window.__ModuleLoader__.load({ id, factory })`; it is NOT a
 * bare ESM module. The `id` is this package's name (the module-graph row id),
 * and the factory returns the plugin exports the Cordis loader consumes
 * (`apply` / `inject`). This bundle has no external imports, so `require` is
 * unused.
 *
 * What it fixes on Android / iOS / HarmonyOS:
 *   1. The viewport meta gains `viewport-fit=cover` (notch/home-indicator safe
 *      areas) and `interactive-widget=resizes-content` (Android keyboard).
 *   2. The page is pinned and sized to the *visible* viewport
 *      (window.visualViewport.height), so opening the virtual keyboard shrinks
 *      the app smoothly instead of reflowing/jumping it.
 *   3. The composer input gets a 16px font floor so iOS Safari does not
 *      auto-zoom the page when the field is focused.
 *   4. The shared width axis (--dsh-chat-content-width) is re-anchored to the
 *      column width: the desktop clamp floors at 680px and clips the transcript
 *      on phones.
 *   5. Desktop-only resize chrome (width handles, column drag handles) is
 *      hidden, and media is constrained so it cannot blow the column open.
 */
window.__ModuleLoader__.load({
	id: "dsh-mobile-adaptation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const PLUGIN_ID = "dsh-mobile-adaptation"

		/** Viewport meta content while the plugin is active. */
		const MOBILE_VIEWPORT =
			"width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"

		/**
		 * Classify the operating system from the user agent.
		 * HarmonyOS is checked first because ArkWeb (and HarmonyOS 4) user agents
		 * also contain the "Android" token.
		 * @returns {"harmony" | "android" | "ios" | "other"}
		 */
		function detectOS() {
			const ua = navigator.userAgent
			if (/HarmonyOS|ArkWeb/i.test(ua)) return "harmony"
			if (/Android/i.test(ua)) return "android"
			if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
			// iPadOS 13+ reports as Macintosh but supports multi-touch.
			if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios"
			return "other"
		}

		/**
		 * Whether the mobile adaptation should activate.
		 * Phone OSes always qualify; a touch-primary device on a narrow window
		 * does too, so a touch laptop at full width keeps the desktop layout.
		 * @returns {boolean}
		 */
		function isMobile() {
			const os = detectOS()
			if (os === "android" || os === "ios" || os === "harmony") return true
			const coarse = typeof window.matchMedia === "function"
				&& window.matchMedia("(pointer: coarse)").matches
			return coarse && window.innerWidth <= 1024
		}

		/**
		 * Swap the document viewport meta to the mobile content and return a
		 * restorer.
		 * @returns {() => void} restorer that reinstates the original meta.
		 */
		function installViewportMeta() {
			let meta = document.querySelector('meta[name="viewport"]')
			const original = meta === null ? null : meta.getAttribute("content")
			if (meta === null) {
				meta = document.createElement("meta")
				meta.setAttribute("name", "viewport")
				document.head.appendChild(meta)
			}
			meta.setAttribute("content", MOBILE_VIEWPORT)
			return () => {
				if (meta === null) return
				if (original === null) meta.remove()
				else meta.setAttribute("content", original)
			}
		}

		/** The injected stylesheet. Active only under `html[data-dsh-mobile]`. */
		const MOBILE_CSS = `/* dsh-mobile-adaptation — injected stylesheet. */

/* Tunables: override from your own stylesheet to adjust. */
:root {
  --dsh-mobile-side-pad: 12px;
  --dsh-mobile-composer-font-size: 16px;
}

/* --------------------------------------------------------------------------
 * 1. App shell: pin the page and size it to the visible viewport.
 *    --dsh-vv-height is published by the JS half from window.visualViewport
 *    on every resize; the fallback is the dynamic viewport unit. Body becomes
 *    a fixed, non-scrolling frame so the browser never pans the document when
 *    an input is focused (the "input jumps while typing" symptom).
 * -------------------------------------------------------------------------- */
html[data-dsh-mobile],
html[data-dsh-mobile] body,
html[data-dsh-mobile] #root {
  height: 100%;
}

html[data-dsh-mobile] body {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: var(--dsh-vv-height, 100dvh);
  margin: 0;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}

/* --------------------------------------------------------------------------
 * 2. Shared width axis: the desktop clamp floors at 680px and clips the
 *    transcript on phones. Re-anchor it to the column width.
 * -------------------------------------------------------------------------- */
html[data-dsh-mobile] [data-phase] {
  --dsh-chat-content-width: calc(100% - 2 * var(--dsh-mobile-side-pad));
  --dsh-composer-side-clearance: var(--dsh-mobile-side-pad);
  --dsh-composer-dock-inset: 6px;
}

/* --------------------------------------------------------------------------
 * 3. Composer / keyboard.
 * -------------------------------------------------------------------------- */

/* 16px floor stops iOS Safari auto-zoom on focus (a second "jump"). */
html[data-dsh-mobile] [data-composer-card] {
  font-size: var(--dsh-mobile-composer-font-size);
}

/* Keep the docked composer clear of the home indicator / notch. */
html[data-dsh-mobile] [data-composer-seat] {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* --------------------------------------------------------------------------
 * 4. Remove desktop-only resize chrome on touch screens.
 * -------------------------------------------------------------------------- */
html[data-dsh-mobile] [data-width-handle],
html[data-dsh-mobile] [data-side='sidebar'],
html[data-dsh-mobile] [data-side='details'] {
  display: none !important;
}

/* --------------------------------------------------------------------------
 * 5. Keep embedded media from blowing the column width open.
 * -------------------------------------------------------------------------- */
html[data-dsh-mobile] [data-conversation-scroll] {
  overflow-x: hidden;
}

html[data-dsh-mobile] [data-conversation-scroll] img,
html[data-dsh-mobile] [data-conversation-scroll] video,
html[data-dsh-mobile] [data-conversation-scroll] pre,
html[data-dsh-mobile] [data-conversation-scroll] table {
  max-width: 100%;
}
`

		const inject = []

		/**
		 * Client plugin body: mark the document, install the viewport meta and the
		 * stylesheet, and keep the shell height tracking the visual viewport.
		 * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
		 */
		function apply(ctx) {
			const root = document.documentElement

			// Platform flags + viewport meta.
			ctx.effect(() => {
				root.dataset.dshOs = detectOS()
				const sync = () => {
					if (isMobile()) root.dataset.dshMobile = ""
					else delete root.dataset.dshMobile
				}
				sync()
				const restoreMeta = installViewportMeta()
				window.addEventListener("resize", sync)
				window.addEventListener("orientationchange", sync)
				return () => {
					window.removeEventListener("resize", sync)
					window.removeEventListener("orientationchange", sync)
					restoreMeta()
					delete root.dataset.dshOs
					delete root.dataset.dshMobile
				}
			}, `${PLUGIN_ID}: platform flags + viewport meta`)

			// Global stylesheet.
			ctx.effect(() => {
				const tag = document.createElement("style")
				tag.dataset.plugin = PLUGIN_ID
				tag.dataset.pluginCss = `${PLUGIN_ID}/mobile.css`
				tag.textContent = MOBILE_CSS
				document.head.appendChild(tag)
				return () => { tag.remove() }
			}, `${PLUGIN_ID}: stylesheet`)

			// Track the visual viewport and publish the live size as CSS
			// variables, so the shell height always equals the area the keyboard
			// leaves visible.
			ctx.effect(() => {
				const vv = window.visualViewport
				if (vv === undefined || vv === null) return

				let frame = null
				const update = () => {
					root.style.setProperty("--dsh-vv-height", `${vv.height}px`)
					root.style.setProperty("--dsh-vv-width", `${vv.width}px`)
					root.style.setProperty("--dsh-vv-offset-top", `${vv.offsetTop}px`)
					// Overlay-mode keyboard inset (iOS keeps the layout viewport
					// fixed and overlays the keyboard on the visual viewport).
					// resizes-content Android shrinks window.innerHeight too, so
					// the inset is 0 there.
					const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
					root.style.setProperty("--dsh-vv-inset", `${inset}px`)
				}
				const schedule = () => {
					if (frame !== null) return
					frame = requestAnimationFrame(() => {
						frame = null
						update()
					})
				}
				vv.addEventListener("resize", schedule)
				vv.addEventListener("scroll", schedule)
				window.addEventListener("resize", schedule)
				update()
				return () => {
					if (frame !== null) cancelAnimationFrame(frame)
					vv.removeEventListener("resize", schedule)
					vv.removeEventListener("scroll", schedule)
					window.removeEventListener("resize", schedule)
					for (const name of ["--dsh-vv-height", "--dsh-vv-width", "--dsh-vv-offset-top", "--dsh-vv-inset"]) {
						root.style.removeProperty(name)
					}
				}
			}, `${PLUGIN_ID}: visual viewport`)
		}

		exports.inject = inject
		exports.apply = apply
		return module.exports
	}
});

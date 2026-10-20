// ── Incremental streaming Markdown renderer ──────────────────────────────────
// Re-parsing the whole answer on every streamed chunk is O(n²) work: each
// update re-runs marked.parse(), builds a DOM document and rebuilds all HTML.
// This helper instead:
//   • appends only the newly arrived text as plain nodes (O(1) per update),
//   • throttles repaints to one per animation frame (~30–60 FPS),
//   • re-renders Markdown at most once per debounce interval (default 400 ms),
//     and only for the last block — earlier blocks keep their existing DOM,
//   • renders the completed answer exactly once when the stream finalizes.
//
// The module is UMD-style so it can be require()'d from the Electron main
// process (unit tests / tooling) and bundled into the renderer via
// src/components/index.js.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.StreamingMarkdownRenderer = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // How often the *in-progress* answer may be re-parsed as Markdown while
    // tokens are still arriving. Streaming itself is throttled to one paint
    // per animation frame; full Markdown parsing happens at most this often.
    const DEFAULT_MARKDOWN_DEBOUNCE_MS = 400;

    // Safety cap on retained history per block (characters). Older content is
    // replaced with an ellipsis marker so a pathological stream cannot grow
    // the DOM without bound.
    const MAX_BLOCK_CHARS = 200000;

    class StreamingMarkdownRenderer {
        /**
         * @param {HTMLElement} container Element whose children we manage.
         * @param {Object} [options]
         * @param {function(string): string} [options.renderMarkdown] Converts a
         *   Markdown string to trusted HTML (e.g. marked + word spans).
         * @param {number} [options.markdownDebounceMs] Min. interval between
         *   in-flight Markdown re-renders of the active block.
         */
        constructor(container, options = {}) {
            this.container = container;
            this.renderMarkdown = typeof options.renderMarkdown === 'function' ? options.renderMarkdown : null;
            this.markdownDebounceMs = Number.isFinite(options.markdownDebounceMs)
                ? Math.max(50, options.markdownDebounceMs)
                : DEFAULT_MARKDOWN_DEBOUNCE_MS;

            this._blocks = []; // { el, text, dirty, renderedHtml } — one per streamed response
            this._activeIndex = -1;
            this._rafId = null;
            this._debounceTimer = null;
            this._lastParseAt = 0;
            this._pendingText = null; // full text handed to begin()/update()
        }

        // ── Public API ──────────────────────────────────────────────────────

        /** Remove every managed block (view detached / recreated). */
        clear() {
            this._cancelScheduled();
            for (const block of this._blocks) {
                if (block.el.parentNode === this.container) this.container.removeChild(block.el);
            }
            this._blocks = [];
            this._activeIndex = -1;
        }

        /** Drop blocks that no longer correspond to live responses. */
        trimTo(count) {
            while (this._blocks.length > count) {
                const block = this._blocks.pop();
                if (block.el.parentNode === this.container) this.container.removeChild(block.el);
            }
            if (this._activeIndex >= this._blocks.length) this._activeIndex = this._blocks.length - 1;
        }

        /** Start showing an existing (possibly already finished) response. */
        begin(fullText, { streaming = false } = {}) {
            this._pendingText = fullText;
            const block = this._ensureActiveBlock();
            this._setBlockText(block, fullText);
            if (streaming) {
                this._scheduleFrame();
            } else {
                this._renderBlockFinal(block);
            }
        }

        /** Replace the content of the currently displayed streamed response. */
        update(fullText) {
            this._pendingText = fullText;
            const block = this._ensureActiveBlock();
            this._setBlockText(block, fullText);
            this._scheduleFrame();
        }

        /** Mark the active response as complete: render Markdown exactly once. */
        finalize(fullText) {
            this._pendingText = fullText;
            const block = this._ensureActiveBlock();
            this._setBlockText(block, fullText);
            this._cancelScheduled();
            this._renderBlockFinal(block);
        }

        /** Re-render the given response in place (e.g. after theme changes). */
        renderFinalAt(index, fullText) {
            const block = this._ensureBlockAt(index);
            this._setBlockText(block, fullText);
            this._renderBlockFinal(block);
        }

        /**
         * Make the block for `index` the visible one. Hidden blocks keep their
         * DOM intact — switching answers never rebuilds anything.
         */
        setActive(index) {
            this._ensureBlockAt(index);
            this._activeIndex = index;
            for (let i = 0; i < this._blocks.length; i++) {
                this._blocks[i].el.style.display = i === index ? '' : 'none';
            }
        }

        get activeIndex() {
            return this._activeIndex;
        }

        // ── Internals ───────────────────────────────────────────────────────

        _ensureBlockAt(index) {
            if (!this.container) return null;
            while (this._blocks.length <= index) {
                const el = document.createElement('div');
                el.className = 'response-block';
                el.style.display = 'none';
                this.container.appendChild(el);
                this._blocks.push({ el, text: '', dirty: true, renderedHtml: null });
            }
            return this._blocks[index];
        }

        _ensureActiveBlock() {
            if (this._activeIndex < 0) this.setActive(0);
            return this._blocks[this._activeIndex];
        }

        _setBlockText(block, text) {
            if (typeof text !== 'string') text = text == null ? '' : String(text);
            if (text.length > MAX_BLOCK_CHARS) text = '…\n' + text.slice(-MAX_BLOCK_CHARS);
            block.text = text;
            block.dirty = true;
        }

        _scheduleFrame() {
            // Coalesce bursts of tokens into at most one paint per frame.
            if (this._rafId != null) return;
            const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 16);
            this._rafId = raf(() => {
                this._rafId = null;
                this._paintActiveStreaming();
            });
        }

        _cancelScheduled() {
            if (this._rafId != null) {
                const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
                caf(this._rafId);
                this._rafId = null;
            }
            if (this._debounceTimer != null) {
                clearTimeout(this._debounceTimer);
                this._debounceTimer = null;
            }
        }

        /** Paint the in-progress response without rebuilding unchanged DOM. */
        _paintActiveStreaming() {
            const block = this._blocks[this._activeIndex];
            if (!block || !block.dirty) return;
            block.dirty = false;

            const text = block.text;
            if (block.renderedHtml != null) {
                // Plain-text mode: append only what actually changed.
                if (text.startsWith(block.renderedHtml)) {
                    const added = text.slice(block.renderedHtml.length);
                    if (added) block.el.appendChild(document.createTextNode(added));
                } else {
                    block.el.textContent = text;
                }
                block.renderedHtml = text;
            } else if (block.el.firstChild) {
                // Block was previously Markdown-formatted; a new token arrived.
                // Flatten to plain text once (preserving the visible words),
                // then continue appending incrementally.
                const previous = block.renderedHtml ?? block.el.textContent;
                block.el.textContent = '';
                if (previous && text.startsWith(previous)) block.el.appendChild(document.createTextNode(text.slice(previous.length)));
                else block.el.textContent = text;
                block.renderedHtml = text;
            } else {
                block.el.textContent = text;
                block.renderedHtml = text;
            }

            this._scheduleDebouncedMarkdown();
        }

        /** Occasionally upgrade the *last block only* to formatted Markdown. */
        _scheduleDebouncedMarkdown() {
            if (!this.renderMarkdown || this._debounceTimer != null) return;
            const wait = Math.max(0, this.markdownDebounceMs - (Date.now() - this._lastParseAt));
            this._debounceTimer = setTimeout(() => {
                this._debounceTimer = null;
                const block = this._blocks[this._activeIndex];
                if (!block) return;
                if (Date.now() - this._lastParseAt < this.markdownDebounceMs) {
                    this._scheduleDebouncedMarkdown();
                    return;
                }
                this._lastParseAt = Date.now();
                this._renderBlockMarkdown(block);
            }, wait);
            if (this._debounceTimer && typeof this._debounceTimer.unref === 'function') this._debounceTimer.unref();
        }

        _renderBlockMarkdown(block) {
            if (!this.renderMarkdown) return;
            const html = this.renderMarkdown(block.text);
            if (html == null) return;
            block.el.innerHTML = html;
            block.renderedHtml = null; // next token falls back to plain-append path
        }

        _renderBlockFinal(block) {
            if (!block) return;
            if (this.renderMarkdown && block.text.trim()) {
                this._renderBlockMarkdown(block);
            } else {
                block.el.textContent = block.text;
                block.renderedHtml = block.text;
            }
            block.dirty = false;
        }
    }

    return StreamingMarkdownRenderer;
});

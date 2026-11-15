import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

const FEEDBACK_FORM_URL = 'https://forms.gle/1JPoh81mUPkJMvje7';

export class FeedbackView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .feedback-embed {
                width: 100%;
                height: min(78vh, 900px);
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-elevated);
                overflow: hidden;
            }

            .feedback-iframe {
                width: 100%;
                height: 100%;
                border: 0;
                background: #fff;
            }
        `,
    ];

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">Feedback</div>

                    <section class="surface">
                        <div class="feedback-embed">
                            <p>Open the feedback form in your browser.</p>
                            <button class="control" @click=${() => window.wehelp.operations['open-external'](FEEDBACK_FORM_URL)}>
                                Open feedback form
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        `;
    }
}

customElements.define('feedback-view', FeedbackView);

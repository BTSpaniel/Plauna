// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ChatThread - a conversation: grouped message bubbles with avatars, names,
 * times and read receipts, a typing indicator and an optional composer
 * (Enter sends). Fires 'send' with the text; the message is appended.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, ensureKeyframes, variantStyles, bindInteraction, TRANSITION } from '../shared/appearance.js';

let _chatSequence = 0;

function _newChatId() {
    return `chat-thread-${Date.now()}-${++_chatSequence}`;
}

const GRADIENTS = [['#0ea5e9', '#6366f1'], ['#f43f5e', '#f59e0b'], ['#10b981', '#0ea5e9'], ['#8b5cf6', '#ec4899']];

const MESSAGES = [
    { from: 'them', name: 'Ada', text: 'Did the GPU parity run finish?', time: '22:01' },
    { from: 'them', name: 'Ada', text: 'The overview looked a pixel off earlier.', time: '22:01' },
    { from: 'me', name: 'You', text: 'Yes — 550/550, and text matches DOM at 125% too.', time: '22:03', status: 'read' },
    { from: 'me', name: 'You', text: 'The half-pixel header was rounding twice.', time: '22:03', status: 'read' },
    { from: 'them', name: 'Ada', text: 'Nice. Ship it 🚀', time: '22:04' }
];

export class ChatThread extends UINode {
    static id = 'chat-thread';
    static name = 'Chat Thread';
    static category = 'dataviews';
    static icon = '💬';
    static description = 'Conversation bubbles with avatars, receipts and a composer';
    static tags = ['dataviews', 'chat', 'messages', 'conversation', 'bubbles', 'messenger'];
    static dependencies = [];
    static optionValues = { tone: TONES, bubble: ['filled', 'soft'], typing: 'boolean', composer: 'boolean', showAvatars: 'boolean' };

    static getDefaultOptions() {
        return { messages: MESSAGES, tone: 'primary', bubble: 'filled', typing: true, typingName: 'Ada', composer: true, showAvatars: true, height: 0 };
    }

    static stories() {
        return {
            'Conversation': { messages: MESSAGES },
            'Soft accent': { messages: MESSAGES.slice(0, 4), tone: 'accent', bubble: 'soft', typing: false },
            'Read only': { messages: MESSAGES.slice(2), composer: false, typing: false, showAvatars: false }
        };
    }

    static create(container, options = {}) {
        const instance = new ChatThread(_newChatId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newChatId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...ChatThread.getDefaultOptions(), ...options };
        this.messages = (Array.isArray(this.options.messages) ? this.options.messages : []).map((m) => ({ ...m }));
        this.draft = '';
        this.build();
    }

    avatar(name, key) {
        const [from, to] = GRADIENTS[[...String(name)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 0) % GRADIENTS.length];
        return el(this, key, 'span', {
            attrs: { 'aria-hidden': 'true' }, text: String(name).slice(0, 1).toUpperCase(),
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flex: '0 0 auto', borderRadius: '50%', fontSize: '12px', fontWeight: '700', color: '#ffffff', backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }
        });
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        this.role = 'log';
        this.ariaLabel = 'Conversation';
        this.setStyles({
            display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '440px', boxSizing: 'border-box', borderRadius: '16px', overflow: 'hidden',
            border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--surface-card, #0f0f17)'
        });
        this.list = el(this, 'list', 'div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '14px 12px', maxHeight: this.options.height ? `${this.options.height}px` : 'none', overflowY: 'auto' } });
        this.appendChild(this.list);
        this.renderMessages();
        if (this.options.composer) this.buildComposer();
    }

    renderMessages() {
        for (const child of [...this.list.children]) child.destroy();
        const c = tone(this.options.tone);
        const soft = this.options.bubble === 'soft';
        this.messages.forEach((message, index) => {
            const mine = message.from === 'me';
            const prev = this.messages[index - 1];
            const next = this.messages[index + 1];
            const first = !prev || prev.from !== message.from;
            const last = !next || next.from !== message.from;
            const r = '16px';
            const tight = '6px';
            const bubble = el(this, `bubble-${index}`, 'div', {
                text: message.text,
                style: {
                    maxWidth: '78%', padding: '8px 12px', borderRadius: mine ? `${r} ${first ? r : tight} ${tight} ${r}` : `${first ? r : tight} ${r} ${r} ${tight}`,
                    fontSize: '14px', lineHeight: '1.45', overflowWrap: 'anywhere',
                    backgroundColor: mine ? (soft ? c.soft : c.base) : 'var(--bg-tertiary, #171723)',
                    color: mine ? (soft ? 'var(--text-primary, #e4e4e7)' : c.on) : 'var(--text-primary, #e4e4e7)',
                    border: mine && soft ? `1px solid ${c.subtleBorder}` : '1px solid transparent'
                }
            });
            const showAvatar = this.options.showAvatars && !mine;
            const row = el(this, `row-${index}`, 'div', {
                style: { display: 'flex', alignItems: 'flex-end', gap: '8px', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: first && index > 0 ? '10px' : '0' },
                children: [
                    showAvatar ? (last ? this.avatar(message.name || '?', `avatar-${index}`) : el(this, `avatar-gap-${index}`, 'span', { style: { width: '28px', flex: '0 0 auto' } })) : null,
                    bubble
                ]
            });
            if (first && !mine && message.name) {
                this.list.appendChild(el(this, `name-${index}`, 'div', { text: message.name, style: { fontSize: '11px', fontWeight: '650', color: 'var(--text-tertiary, #9ca3af)', margin: `${index > 0 ? 10 : 0}px 0 2px ${showAvatar ? 36 : 2}px` } }));
                row.setStyle('marginTop', '0');
            }
            this.list.appendChild(row);
            if (last && message.time) {
                const meta = [el(this, `time-${index}`, 'span', { text: message.time })];
                if (mine && message.status) {
                    meta.push(el(this, `receipt-${index}`, 'span', {
                        style: { display: 'inline-flex', color: message.status === 'read' ? c.base : 'var(--text-tertiary, #9ca3af)' },
                        children: [icon(this, `receipt-a-${index}`, ICONS.check, 13, { strokeWidth: 2.5 }), ...(message.status === 'read' || message.status === 'delivered' ? [icon(this, `receipt-b-${index}`, ICONS.check, 13, { strokeWidth: 2.5, style: { marginLeft: '-8px' } })] : [])]
                    }));
                }
                this.list.appendChild(el(this, `meta-${index}`, 'div', {
                    style: { display: 'flex', alignItems: 'center', gap: '4px', justifyContent: mine ? 'flex-end' : 'flex-start', fontSize: '11px', color: 'var(--text-tertiary, #9ca3af)', margin: `3px 2px 0 ${showAvatar ? 38 : 2}px` },
                    children: meta
                }));
            }
        });
        if (this.options.typing) {
            ensureKeyframes('plauna-typing', '0%, 60%, 100% { transform: translateY(0); opacity: 0.45; } 30% { transform: translateY(-3px); opacity: 1; }');
            this.list.appendChild(el(this, 'typing', 'div', {
                label: `${this.options.typingName} is typing`, role: 'status',
                style: { display: 'flex', alignItems: 'flex-end', gap: '8px', marginTop: '10px' },
                children: [
                    this.options.showAvatars ? this.avatar(this.options.typingName, 'typing-avatar') : null,
                    el(this, 'typing-bubble', 'div', {
                        style: { display: 'inline-flex', gap: '4px', padding: '11px 12px', borderRadius: '16px 16px 16px 6px', backgroundColor: 'var(--bg-tertiary, #171723)' },
                        children: [0, 1, 2].map((i) => el(this, `typing-dot-${i}`, 'span', {
                            style: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--text-secondary, #d1d5db)', opacity: '0.45', animation: `plauna-typing 1.2s ease-in-out ${i * 0.15}s infinite` }
                        }))
                    })
                ]
            }));
        }
    }

    buildComposer() {
        const c = tone(this.options.tone);
        this.input = el(this, 'input', 'input', {
            label: 'Message', data: { type: 'text', placeholder: 'Write a message…', value: '' }, attrs: { autocomplete: 'off' },
            style: { flex: '1', minWidth: '0', height: '36px', boxSizing: 'border-box', padding: '0 12px', borderRadius: '9999px', border: '1px solid var(--border-medium, #3a3a4a)', backgroundColor: 'var(--bg-tertiary, #171723)', color: 'var(--text-primary, #e4e4e7)', fontFamily: 'inherit', fontSize: '13px', outline: 'none', transition: TRANSITION }
        });
        this.input.addEventListener('input', (event) => { this.draft = event?.domTarget?.value ?? ''; });
        this.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault?.(); this.send(); } });
        this.input.addEventListener('focus', () => this.input.setStyles({ borderColor: c.base, boxShadow: `0 0 0 3px ${c.soft}` }));
        this.input.addEventListener('blur', () => this.input.setStyles({ borderColor: 'var(--border-medium, #3a3a4a)', boxShadow: 'none' }));
        const sendButton = el(this, 'send', 'button', {
            label: 'Send', attrs: { type: 'button' },
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: '0', borderRadius: '50%', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION, flex: '0 0 auto' },
            children: [icon(this, 'send-icon', ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'], 16)]
        });
        bindInteraction(sendButton, (state) => sendButton.setStyles(variantStyles('solid', this.options.tone, state)));
        sendButton.addEventListener('click', () => this.send());
        this.appendChild(el(this, 'composer', 'div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderTop: '1px solid var(--border-light, #2a2a3a)' },
            children: [this.input, sendButton]
        }));
    }

    send() {
        const text = this.draft.trim();
        if (!text) return;
        const now = new Date();
        this.messages.push({ from: 'me', name: 'You', text, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, status: 'sent' });
        this.draft = '';
        this.input.userData.value = '';
        if (this.input.element) this.input.element.value = '';
        this.renderMessages();
        this.dispatchEvent({ type: 'send', target: this, text });
        const list = this.list.element;
        if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
}

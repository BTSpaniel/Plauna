// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * AvatarGroup - overlapping avatars with a "+N" overflow, for teams,
 * participants and assignees. Initials sit on a gradient picked from the
 * name, so every person keeps the same colours.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, SIZES, TRANSITION } from '../shared/appearance.js';

let _avatarGroupSequence = 0;

function _newAvatarGroupId() {
    return `avatar-group-${Date.now()}-${++_avatarGroupSequence}`;
}

const GRADIENTS = [
    ['#0ea5e9', '#6366f1'], ['#f43f5e', '#f59e0b'], ['#10b981', '#0ea5e9'], ['#8b5cf6', '#ec4899'],
    ['#f59e0b', '#ef4444'], ['#14b8a6', '#84cc16'], ['#6366f1', '#a855f7'], ['#ec4899', '#8b5cf6']
];

const DIAMETERS = { xs: 24, sm: 30, md: 38, lg: 46, xl: 56 };

function hashName(name) {
    let hash = 0;
    for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash;
}

function initialsOf(name) {
    const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
    return letters.toUpperCase();
}

const PEOPLE = [
    { name: 'Ada Lovelace', status: 'online' }, { name: 'Grace Hopper' }, { name: 'Alan Turing', status: 'busy' },
    { name: 'Katherine Johnson' }, { name: 'Linus Torvalds' }, { name: 'Margaret Hamilton', status: 'online' },
    { name: 'Dennis Ritchie' }, { name: 'Barbara Liskov' }
];

export class AvatarGroup extends UINode {
    static id = 'avatar-group';
    static name = 'Avatar Group';
    static category = 'primitive';
    static icon = '👥';
    static description = 'Overlapping avatars with an overflow count';
    static tags = ['primitive', 'avatar', 'group', 'team', 'people', 'stack'];
    static dependencies = [];
    static optionValues = { size: SIZES, shape: ['circle', 'rounded'], spacing: ['tight', 'normal', 'loose'], showStatus: 'boolean' };

    static getDefaultOptions() {
        return { people: PEOPLE.slice(0, 5), max: 4, size: 'md', shape: 'circle', spacing: 'normal', showStatus: false };
    }

    static stories() {
        return {
            'Team': { people: PEOPLE.slice(0, 6), max: 4, size: 'md' },
            'With status': { people: PEOPLE.slice(0, 4), max: 4, size: 'lg', showStatus: true },
            'Tight small': { people: PEOPLE, max: 6, size: 'sm', spacing: 'tight' },
            'Rounded squares': { people: PEOPLE.slice(2, 7), max: 3, size: 'lg', shape: 'rounded', spacing: 'loose' }
        };
    }

    static create(container, options = {}) {
        const instance = new AvatarGroup(_newAvatarGroupId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newAvatarGroupId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...AvatarGroup.getDefaultOptions(), ...options };
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, shape, spacing, showStatus } = this.options;
        const people = Array.isArray(this.options.people) ? this.options.people : [];
        const max = Math.max(1, Number(this.options.max) || people.length || 1);
        const diameter = DIAMETERS[size] || DIAMETERS.md;
        const overlap = Math.round(diameter * ({ tight: 0.3, normal: 0.2, loose: 0.08 }[spacing] ?? 0.2));
        const radius = shape === 'rounded' ? `${Math.round(diameter * 0.28)}px` : '50%';
        const shown = people.slice(0, max);
        const extra = people.length - shown.length;
        this.role = 'group';
        this.ariaLabel = `${people.length} people`;
        this.setStyles({ display: 'inline-flex', alignItems: 'center', paddingLeft: `${overlap}px` });
        const ring = '2px solid var(--bg-primary, #0a0a0f)';
        const base = {
            position: 'relative', flex: '0 0 auto', width: `${diameter}px`, height: `${diameter}px`,
            marginLeft: `-${overlap}px`, borderRadius: radius, border: ring, boxSizing: 'content-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: TRANSITION,
            fontSize: `${Math.round(diameter * 0.36)}px`, fontWeight: '700', letterSpacing: '0.02em', cursor: 'default'
        };
        shown.forEach((person, index) => {
            const [from, to] = GRADIENTS[hashName(person.name) % GRADIENTS.length];
            const avatar = el(this, `person-${index}`, 'span', {
                attrs: { title: person.name },
                label: person.name,
                role: 'img',
                style: {
                    ...base, zIndex: String(shown.length - index), color: '#ffffff',
                    backgroundImage: person.src ? 'none' : `linear-gradient(135deg, ${from}, ${to})`,
                    backgroundColor: 'var(--bg-tertiary, #171723)', overflow: 'visible'
                }
            });
            if (person.src) {
                avatar.appendChild(el(this, `img-${index}`, 'img', {
                    data: { src: person.src, alt: '' },
                    style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: radius }
                }));
            } else {
                avatar.appendChild(el(this, `initials-${index}`, 'span', { text: initialsOf(person.name), attrs: { 'aria-hidden': 'true' } }));
            }
            if (showStatus && person.status) {
                const color = { online: 'var(--color-success, #10b981)', busy: 'var(--color-error, #ef4444)', away: 'var(--color-warning, #f59e0b)' }[person.status] || 'var(--text-disabled, #6b7280)';
                const dot = Math.max(8, Math.round(diameter * 0.26));
                avatar.appendChild(el(this, `status-${index}`, 'span', {
                    attrs: { 'aria-hidden': 'true' },
                    style: { position: 'absolute', right: '-1px', bottom: '-1px', width: `${dot}px`, height: `${dot}px`, borderRadius: '50%', backgroundColor: color, border: ring }
                }));
            }
            avatar.addEventListener('mouseenter', () => avatar.setStyles({ transform: 'translateY(-3px)', zIndex: '50' }));
            avatar.addEventListener('mouseleave', () => avatar.setStyles({ transform: 'none', zIndex: String(shown.length - index) }));
            this.appendChild(avatar);
        });
        if (extra > 0) {
            this.appendChild(el(this, 'more', 'span', {
                text: `+${extra}`, label: `${extra} more`, role: 'img',
                style: {
                    ...base, zIndex: '0', fontSize: `${Math.round(diameter * 0.32)}px`,
                    color: 'var(--text-secondary, #d1d5db)', backgroundColor: 'var(--bg-quaternary, #1f1f2e)'
                }
            }));
        }
    }

    setPeople(people) {
        this.options.people = people;
        this.build();
    }

    setMax(max) {
        this.options.max = max;
        this.build();
    }

    setSize(size) {
        this.options.size = size;
        this.build();
    }
}

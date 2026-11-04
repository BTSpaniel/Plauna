// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Hand-written controls for widgets whose options need setters or extra
 * work to apply live. Each field: key, label, type (text, textarea, number,
 * range, boolean, select), group, options (select), min/max/step, read(
 * instance, storyOptions) and apply(instance, value, state). Widgets without
 * a schema get controls inferred from their stories (see controls.js).
 */

import { DIRTY, NODE_STATE } from '../../core/UINode.js';

const TEXT_SIZE_PRESETS = {
    xs: '12px',
    sm: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px'
};

export const CUSTOMIZATION_SCHEMAS = {
    button: [
        {
            key: 'text',
            label: 'Text',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.text ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['primary', 'secondary', 'soft', 'surface', 'outline', 'ghost', 'gradient', 'link', 'danger', 'warning', 'success'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'primary',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            group: 'Appearance',
            read: (instance) => instance.icon ?? '',
            apply: (instance, value, state) => instance.setIcon(value, state.values.iconPosition || instance.iconPosition || 'left')
        },
        {
            key: 'iconPosition',
            label: 'Icon Position',
            type: 'select',
            group: 'Appearance',
            options: ['left', 'right'],
            read: (instance) => instance.iconPosition ?? 'left',
            apply: (instance, value, state) => instance.setIcon(state.values.icon || instance.icon || '', value)
        },
        {
            key: 'disabled',
            label: 'Disabled',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.disabled ?? storyOptions.disabled ?? false),
            apply: (instance, value) => instance.setDisabled(Boolean(value))
        },
        {
            key: 'loading',
            label: 'Loading',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.hasState?.(NODE_STATE.LOADING) ?? storyOptions.loading ?? false),
            apply: (instance, value) => instance.setLoading(Boolean(value))
        }
    ],
    badge: [
        {
            key: 'label',
            label: 'Label',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.label ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'secondary', 'success', 'warning', 'error', 'info', 'outline', 'subtle'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'primary',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'shape',
            label: 'Shape',
            type: 'select',
            group: 'Appearance',
            options: ['rounded', 'pill', 'square'],
            read: (instance, storyOptions) => instance.shape ?? storyOptions.shape ?? 'rounded',
            apply: (instance, value) => {
                instance.shape = value;
                instance.setupStyles();
                instance.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            }
        },
        {
            key: 'dot',
            label: 'Dot',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.dot ?? storyOptions.dot ?? false),
            apply: (instance, value) => instance.setDot(Boolean(value))
        },
        {
            key: 'count',
            label: 'Count',
            type: 'number',
            group: 'Content',
            read: (instance) => instance.count ?? 0,
            min: 0,
            step: 1,
            apply: (instance, value) => instance.setCount(Number(value))
        },
        {
            key: 'maxCount',
            label: 'Max Count',
            type: 'number',
            group: 'Advanced',
            read: (instance) => instance.maxCount ?? 99,
            min: 1,
            step: 1,
            apply: (instance, value) => instance.setMaxCount(Number(value))
        },
        {
            key: 'showZero',
            label: 'Show Zero',
            type: 'boolean',
            group: 'Advanced',
            read: (instance, storyOptions) => Boolean(instance.showZero ?? storyOptions.showZero ?? false),
            apply: (instance, value) => instance.setShowZero(Boolean(value))
        },
        {
            key: 'position',
            label: 'Position',
            type: 'select',
            group: 'Advanced',
            options: ['static', 'top-right', 'top-left'],
            read: (instance, storyOptions) => instance.position ?? storyOptions.position ?? 'static',
            apply: (instance, value) => {
                instance.position = value;
                instance.setupStyles();
                instance.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            }
        }
    ],
    avatar: [
        {
            key: 'src',
            label: 'Image URL',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.src ?? storyOptions.src ?? '',
            apply: (instance, value) => instance.setSrc(value)
        },
        {
            key: 'name',
            label: 'Name',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.name ?? storyOptions.name ?? '',
            apply: (instance, value) => instance.setName(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'shape',
            label: 'Shape',
            type: 'select',
            group: 'Appearance',
            options: ['circle', 'square', 'rounded'],
            read: (instance, storyOptions) => instance.shape ?? storyOptions.shape ?? 'circle',
            apply: (instance, value) => instance.setShape(value)
        },
        {
            key: 'status',
            label: 'Status',
            type: 'select',
            group: 'State',
            options: [null, 'online', 'offline', 'busy', 'away', 'focus'],
            read: (instance, storyOptions) => instance.status ?? storyOptions.status ?? null,
            apply: (instance, value) => instance.setStatus(value || null)
        },
        {
            key: 'fallback',
            label: 'Fallback',
            type: 'select',
            group: 'Content',
            options: ['initials', 'icon', 'placeholder'],
            read: (instance, storyOptions) => instance.fallback ?? storyOptions.fallback ?? 'initials',
            apply: (instance, value) => instance.setFallback(value)
        },
        {
            key: 'showStatus',
            label: 'Show Status',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.showStatus ?? storyOptions.showStatus ?? true),
            apply: (instance, value) => instance.setShowStatus(Boolean(value))
        },
        {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            group: 'Content',
            read: (instance) => instance.icon ?? '',
            apply: (instance, value) => instance.setIcon(value)
        }
    ],
    chip: [
        {
            key: 'label',
            label: 'Label',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.label ?? storyOptions.label ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setLabel(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'primary', 'secondary', 'success', 'warning', 'error'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'removable',
            label: 'Removable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.removable ?? storyOptions.removable ?? false),
            apply: (instance, value) => instance.setRemovable(Boolean(value))
        },
        {
            key: 'disabled',
            label: 'Disabled',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.disabled ?? storyOptions.disabled ?? false),
            apply: (instance, value) => instance.setDisabled(Boolean(value))
        }
    ],
    modal: [
        {
            key: 'title',
            label: 'Title',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.title ?? storyOptions.title ?? '',
            apply: (instance, value) => instance.setTitle(value)
        },
        {
            key: 'content',
            label: 'Content',
            type: 'textarea',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'open',
            label: 'Open',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.open ?? storyOptions.open ?? false),
            apply: (instance, value) => {
                instance.open = Boolean(value);
                if (typeof instance.updateOpenState === 'function') {
                    instance.updateOpenState();
                }
                instance.markDirty(DIRTY.PAINT);
            }
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['sm', 'md', 'lg'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        }
    ],
    'panel-primitive': [
        {
            key: 'title',
            label: 'Title',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.title ?? storyOptions.title ?? '',
            apply: (instance, value) => instance.setTitle(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'card', 'elevated', 'outlined', 'ghost'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        }
    ],
    progress: [
        {
            key: 'value',
            label: 'Value',
            type: 'range',
            group: 'Content',
            min: 0,
            max: (instance) => Number(instance.max ?? 100),
            step: 1,
            read: (instance, storyOptions) => Number(instance.value ?? storyOptions.value ?? 0),
            visibleWhen: (instance) => !Boolean(instance.indeterminate),
            apply: (instance, value) => instance.setValue(Number(value))
        },
        {
            key: 'max',
            label: 'Max',
            type: 'number',
            group: 'Content',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => Number(instance.max ?? storyOptions.max ?? 100),
            apply: (instance, value) => instance.setMax(Number(value))
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'success', 'warning', 'error', 'info'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'type',
            label: 'Type',
            type: 'select',
            group: 'Appearance',
            options: ['linear', 'circular'],
            read: (instance, storyOptions) => instance.type ?? storyOptions.type ?? 'linear',
            apply: (instance, value) => instance.setType(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'indeterminate',
            label: 'Indeterminate',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.indeterminate ?? storyOptions.indeterminate ?? false),
            apply: (instance, value) => instance.setIndeterminate(Boolean(value))
        },
        {
            key: 'showPercentage',
            label: 'Show Percentage',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.showPercentage ?? storyOptions.showPercentage ?? true),
            apply: (instance, value) => instance.setShowPercentage(Boolean(value))
        },
        {
            key: 'animated',
            label: 'Animated',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.animated ?? storyOptions.animated ?? true),
            apply: (instance, value) => instance.setAnimated(Boolean(value))
        }
    ],
    skeleton: [
        {
            key: 'type',
            label: 'Type',
            type: 'select',
            group: 'Appearance',
            options: ['text', 'avatar', 'button', 'card', 'image', 'input', 'paragraph'],
            read: (instance, storyOptions) => instance.type ?? storyOptions.type ?? 'text',
            apply: (instance, value) => instance.setType(value)
        },
        {
            key: 'width',
            label: 'Width',
            type: 'text',
            group: 'Appearance',
            read: (instance, storyOptions) => instance.width ?? storyOptions.width ?? '100%',
            apply: (instance, value) => instance.setWidth(value)
        },
        {
            key: 'height',
            label: 'Height',
            type: 'text',
            group: 'Appearance',
            read: (instance, storyOptions) => instance.height ?? storyOptions.height ?? '20px',
            apply: (instance, value) => instance.setHeight(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'rounded', 'sharp', 'circle'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'animated',
            label: 'Animated',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.animated ?? storyOptions.animated ?? true),
            apply: (instance, value) => instance.setAnimated(Boolean(value))
        },
        {
            key: 'count',
            label: 'Count / Lines',
            type: 'number',
            group: 'Content',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => Number(instance.lines ?? instance.count ?? storyOptions.count ?? 1),
            visibleWhen: (instance) => instance.type === 'paragraph',
            apply: (instance, value) => {
                const next = Math.max(1, Number(value) || 1);
                instance.lines = next;
                instance.count = next;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        },
        {
            key: 'circleSize',
            label: 'Circle Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.circleSize ?? storyOptions.circleSize ?? 'md',
            visibleWhen: (instance) => instance.type === 'avatar',
            apply: (instance, value) => {
                instance.circleSize = value;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        },
        {
            key: 'buttonSize',
            label: 'Button Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.buttonSize ?? storyOptions.buttonSize ?? 'md',
            visibleWhen: (instance) => instance.type === 'button',
            apply: (instance, value) => {
                instance.buttonSize = value;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    ],
    text: [
        {
            key: 'content',
            label: 'Content',
            type: 'textarea',
            group: 'Content',
            read: (instance, storyOptions) => instance.text ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setText(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['body', 'heading-1', 'heading-2', 'heading-3', 'caption', 'label', 'code'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'body',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance._galleryTextSize ?? storyOptions.size ?? 'md',
            apply: (instance, value) => {
                instance._galleryTextSize = value;
                instance.setFontSize(TEXT_SIZE_PRESETS[value] || TEXT_SIZE_PRESETS.md);
            }
        },
        {
            key: 'maxLines',
            label: 'Max Lines',
            type: 'number',
            group: 'Advanced',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => instance.maxLines ?? storyOptions.maxLines ?? 0,
            apply: (instance, value) => instance.setMaxLines(Number(value) || null)
        },
        {
            key: 'overflow',
            label: 'Overflow',
            type: 'select',
            group: 'Advanced',
            options: ['wrap', 'nowrap', 'clip'],
            read: (instance, storyOptions) => instance.overflow ?? storyOptions.overflow ?? 'wrap',
            apply: (instance, value) => instance.setOverflow(value)
        },
        {
            key: 'selectable',
            label: 'Selectable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.selectable ?? storyOptions.selectable ?? true),
            apply: (instance, value) => instance.setSelectable(Boolean(value))
        },
        {
            key: 'editable',
            label: 'Editable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.editable ?? storyOptions.editable ?? false),
            apply: (instance, value) => instance.setEditable(Boolean(value))
        }
    ],
    tooltip: [
        {
            key: 'content',
            label: 'Content',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'placement',
            label: 'Placement',
            type: 'select',
            group: 'Appearance',
            options: ['top', 'bottom', 'left', 'right'],
            read: (instance, storyOptions) => instance.placement ?? storyOptions.placement ?? 'top',
            apply: (instance, value) => instance.setPlacement(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'primary', 'success', 'warning', 'error', 'inverse'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'delay',
            label: 'Delay',
            type: 'number',
            group: 'State',
            min: 0,
            step: 25,
            read: (instance, storyOptions) => Number(instance.delay ?? storyOptions.delay ?? 300),
            apply: (instance, value) => {
                instance.delay = Number(value) || 0;
                instance.markDirty(DIRTY.PAINT);
            }
        },
        {
            key: 'trigger',
            label: 'Trigger',
            type: 'select',
            group: 'State',
            options: ['hover', 'focus', 'click'],
            read: (instance) => instance.trigger ?? 'hover',
            apply: (instance, value) => {
                instance.trigger = value;
                if (typeof instance.detach === 'function') {
                    instance.detach();
                }
                instance.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            }
        },
        {
            key: 'offset',
            label: 'Offset',
            type: 'number',
            group: 'Advanced',
            min: 0,
            step: 1,
            read: (instance, storyOptions) => Number(instance.offset ?? storyOptions.offset ?? 8),
            apply: (instance, value) => {
                instance.offset = Number(value) || 0;
                if (instance.visible) {
                    instance.updatePosition();
                }
                instance.markDirty(DIRTY.PAINT);
            }
        }
    ]
};

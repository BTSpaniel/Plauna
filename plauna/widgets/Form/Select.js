// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Select - Multi-option selection widget for Plauna
 * Provides dropdown functionality with search and keyboard navigation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, fieldStyles, OVERLAY, TONES, sizeScale } from '../shared/appearance.js';

let _selectSequence = 0;

function _newSelectId() {
    return `select-${Date.now()}-${++_selectSequence}`;
}

export class Select extends UINode {
    // Widget metadata
    static id = 'select';
    static name = 'Select';
    static category = 'form';
    static icon = '📋';
    static description = 'Dropdown select form control';
    static tags = ['form', 'input', 'select', 'dropdown', 'control'];
    static emits = ['change'];
    static optionValues = { variant: ['default', ...TONES, 'secondary', 'error'], size: ['xs', 'sm', 'md', 'lg', 'xl'], disabled: 'boolean' };
    static dependencies = [];
    
    static stories() {
        return {
            'Default': {
                label: 'Render mode', placeholder: 'Choose a mode', value: 'forward',
                options: [{ value: 'forward', label: 'Forward' }, { value: 'deferred', label: 'Deferred' }, { value: 'path', label: 'Path traced' }]
            },
            'Searchable': {
                label: 'Material', searchable: true,
                options: [{ value: 'stone', label: 'Stone' }, { value: 'wood', label: 'Wood' }, { value: 'metal', label: 'Metal' }, { value: 'glass', label: 'Glass' }]
            },
            'Disabled': { label: 'Backend', disabled: true, value: 'webgpu', options: [{ value: 'webgpu', label: 'WebGPU' }] }
        };
    }
    
    constructor(id = _newSelectId(), options = {}) {
        super(id, 'select');
        // A composite widget: render a <div>, not the native <select> element
        this.tag = 'div';
        
        // Select-specific properties
        this.options = options.options || [];
        this.value = options.value || '';
        this.placeholder = options.placeholder || 'Select an option';
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.searchable = options.searchable !== false;
        this.multiple = options.multiple || false;
        this.clearable = options.clearable !== false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.label = options.label || '';
        this.description = options.description || '';
        this.name = options.name || '';
        this.isOpen = false;
        
        // State management
        this.isFocused = false;
        this.selectedOptions = [];
        this.filteredOptions = [...this.options];
        this.searchTerm = '';
        
        // Set accessibility
        this.role = 'combobox';
        this.ariaExpanded = String(this.isOpen);
        this.ariaControls = `${id}-dropdown-list`;
        this.tabIndex = this.disabled ? null : '0';
        this.highlightedIndex = -1;
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        this.ariaHasPopup = 'listbox';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build select structure
        this.buildSelect();
        
        // Initialize options
        if (options.options) {
            this.setOptions(options.options);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            width: '100%',
            maxWidth: '360px',
            flexDirection: 'column',
            gap: tokens.css('spacing.xs'),
            position: 'relative',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        // The trigger's height comes from the shared size scale (triggerStyles)
        const sizes = {
            xs: { fontSize: tokens.css('fontSizes.xs') },
            sm: { fontSize: tokens.css('fontSizes.sm') },
            md: { fontSize: tokens.css('fontSizes.md') },
            lg: { fontSize: tokens.css('fontSizes.lg') },
            xl: { fontSize: tokens.css('fontSizes.xl') }
        };
        return sizes[this.size] || sizes.md;
    }

    /**
     * Trigger box at this size, on the shared scale: as tall as a Combobox or
     * Password field of the same size (scale height + 4), with room on the
     * right for the arrow and, when clearable, the clear button.
     */
    triggerStyles() {
        const scale = sizeScale(this.size);
        const right = scale.padX + (this.clearable ? 44 : 22);
        return {
            height: `${scale.height + 4}px`,
            boxSizing: 'border-box',
            padding: `0 ${right}px 0 ${scale.padX}px`,
            borderRadius: `${scale.radius + 1}px`,
            fontSize: `${scale.fontSize}px`
        };
    }
    
    getVariantStyles() {
        // variant names the tone of the focus ring and selection; a named tone also tints the label
        return { color: this.variant === 'default' ? 'var(--text-primary, #e4e4e7)' : this.toneColors().text };
    }

    /** The select's tone: default is primary, secondary is neutral, error is danger. */
    toneColors() {
        return toneOf(this.variant);
    }

    /** Shell colours for the current focus, open and disabled state. */
    shellStyles() {
        return fieldStyles(this.variant, { focused: this.isFocused || this.isOpen, disabled: this.disabled });
    }
    
    setupEventHandlers() {
        {
            // Clicks inside the open list belong to the options, not the trigger
            this.addEventListener('click', (e) => {
                if (this.dropdownContainer?.element?.contains(e.domTarget)) return;
                this.toggle();
            });

            this.addEventListener('keydown', (e) => {
                if (this.disabled) return;
                // Typing in the search box is not navigation
                if (e.domTarget?.tagName === 'INPUT' && e.key === ' ') return;
                switch (e.key) {
                    case 'ArrowDown':
                    case 'ArrowUp':
                        e.preventDefault();
                        if (!this.isOpen) {
                            this.open();
                        } else {
                            this.navigateOptions(e.key === 'ArrowUp' ? -1 : 1);
                        }
                        break;
                    case 'Home':
                    case 'End':
                        if (this.isOpen) {
                            e.preventDefault();
                            this.highlightedIndex = e.key === 'Home' ? 0 : this.getVisibleOptions().length - 1;
                            this.renderOptions();
                        }
                        break;
                    case 'Enter':
                    case ' ': {
                        e.preventDefault();
                        if (!this.isOpen) {
                            this.open();
                            break;
                        }
                        const option = this.getVisibleOptions()[this.highlightedIndex];
                        if (option && !option.disabled) {
                            this.selectOption(option);
                        }
                        break;
                    }
                    case 'Escape':
                        if (this.isOpen) {
                            e.preventDefault();
                            this.close();
                        }
                        break;
                    case 'Tab':
                        this.close();
                        break;
                }
            });
            
            this.addEventListener('focus', () => {
                this.isFocused = true;
                this.setState(NODE_STATE.FOCUSED, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
            
            this.addEventListener('blur', () => {
                this.isFocused = false;
                this.setState(NODE_STATE.FOCUSED, false);
                this.close();
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
        }
    }
    
    buildSelect() {
        this.clearChildren();

        // Create select shell
        const selectInput = new UINode(`${this.id}-input`, 'div');
        selectInput.userData.role = 'presentation';
        selectInput.userData.id = `${this.id}-input`;
        const scale = sizeScale(this.size);
        selectInput.setStyles({
            width: '100%',
            ...this.triggerStyles(),
            backgroundColor: this.shellStyles().backgroundColor,
            color: this.getInputColor(),
            border: '1px solid ' + this.getBorderColor(),
            fontWeight: '600',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background-color 160ms ease',
            outline: 'none',
            boxShadow: this.shellStyles().boxShadow,
            display: 'flex',
            alignItems: 'center',
            position: 'relative'
        });

        this.selectValue = new UINode(`${this.id}-value`, 'span');
        this.selectValue.setStyles({
            flex: '1',
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: this.getDisplayValue() ? this.getInputColor() : 'var(--text-secondary, #475569)'
        });
        this.selectValue.textContent = this.getDisplayValue() || this.placeholder;
        
        // Select input styles
        // Clear button if clearable
        let clearButton = null;
        if (this.clearable && this.value) {
            clearButton = new UINode(`${this.id}-clear`, 'button');
            clearButton.type = 'button';
            clearButton.textContent = '×';
            clearButton.setStyles({
                position: 'absolute',
                right: `${scale.padX + 18}px`,
                top: '50%',
                transform: 'translateY(-50%)',
                backgroundColor: 'color-mix(in srgb, var(--text-tertiary, #9ca3af) 16%, transparent)',
                border: 'none',
                color: 'var(--text-secondary, #475569)',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: 'pointer',
                padding: '0',
                width: '20px',
                height: '20px',
                display: this.value ? 'flex' : 'none',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                opacity: '0.85',
                transition: 'opacity 150ms ease'
            });
            
            clearButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clear();
            });
            
            selectInput.appendChild(clearButton);
        }
        
        // Dropdown arrow
        const dropdownArrow = new UINode(`${this.id}-arrow`, 'span');
        dropdownArrow.textContent = '▼';
        dropdownArrow.setStyles({
            position: 'absolute',
            right: `${scale.padX}px`,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary, #475569)',
            fontSize: '12px',
            pointerEvents: 'none',
            transition: 'transform 150ms ease'
        });
        
        selectInput.appendChild(this.selectValue);
        selectInput.appendChild(dropdownArrow);
        this.appendChild(selectInput);
        
        // Create dropdown container
        const dropdownContainer = new UINode(`${this.id}-dropdown`, 'div');
        dropdownContainer.setStyles({
            position: 'absolute',
            top: '100%',
            left: '0',
            right: '0',
            backgroundColor: OVERLAY.backgroundColor,
            border: `1px solid ${OVERLAY.borderColor}`,
            borderRadius: '16px',
            boxShadow: OVERLAY.boxShadow,
            zIndex: 0,
            display: 'none',
            opacity: '0',
            transform: 'translateY(-8px)',
            transition: 'all 150ms ease',
            maxHeight: '200px',
            overflow: 'auto'
        });
        
        // Search input if searchable
        if (this.searchable) {
            const searchInput = new UINode(`${dropdownContainer.id}-search`, 'input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search options...';
            searchInput.setStyles({
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'var(--bg-tertiary, #171723)',
                color: 'var(--text-primary, #e4e4e7)',
                border: '1px solid var(--border-medium, #3a3a4a)',
                borderRadius: '12px',
                fontSize: '14px',
                outline: 'none',
                marginBottom: tokens.css('spacing.sm')
            });
            
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.domTarget.value;
                this.filterOptions();
                this.renderOptions();
            });
            
            dropdownContainer.appendChild(searchInput);
            this.searchInput = searchInput;
        } else {
            this.searchInput = null;
        }
        
        // Options list
        const optionsList = new UINode(`${dropdownContainer.id}-list`, 'ul');
        optionsList.role = 'listbox';
        optionsList.ariaMultiSelectable = this.multiple ? 'true' : null;
        optionsList.setStyles({
            listStyle: 'none',
            margin: '0',
            padding: tokens.css('spacing.xs'),
            maxHeight: '150px',
            overflow: 'auto'
        });
        
        dropdownContainer.appendChild(optionsList);
        this.appendChild(dropdownContainer);
        
        // Store references
        this.selectInput = selectInput;
        this.clearButton = clearButton;
        this.dropdownContainer = dropdownContainer;
        this.optionsList = optionsList;
        this.dropdownArrow = dropdownArrow;
        
        this.updateVisualState();
    }

    updateVisualState() {
        const selectInput = this.querySelector(`#${this.id}-input`);
        const dropdownArrow = this.querySelector(`#${this.id}-arrow`);
        const clearButton = this.querySelector(`#${this.id}-clear`);
        const focusShadow = this.shellStyles().boxShadow;

        if (selectInput) {
            if (selectInput.element) {
                selectInput.element.style.borderColor = this.getBorderColor();
                selectInput.element.style.backgroundColor = this.shellStyles().backgroundColor;
                selectInput.element.style.boxShadow = focusShadow;
                selectInput.element.style.transform = this.isFocused || this.isOpen ? 'translateY(-1px)' : 'translateY(0)';
            }
        }

        if (dropdownArrow && dropdownArrow.element) {
            dropdownArrow.element.style.transform = this.isOpen ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%) rotate(0deg)';
        }

        if (clearButton && clearButton.element) {
            clearButton.element.style.display = this.clearable && this.value ? 'flex' : 'none';
        }

        if (this.dropdownContainer) {
            this.dropdownContainer.setStyle('pointerEvents', this.isOpen ? 'auto' : 'none');
            this.dropdownContainer.setStyle('zIndex', this.isOpen ? '1000' : '0');
        }

        this.updateDisplayValue();
    }
    
    getInputColor() {
        if (this.disabled) {
            return tokens.css('colors.text.disabled');
        }
        return tokens.css('colors.text.primary');
    }
    
    getBorderColor() {
        return this.shellStyles().borderColor;
    }
    
    getDisplayValue() {
        if (this.multiple) {
            if (this.selectedOptions.length === 0) {
                return '';
            }
            if (this.selectedOptions.length === 1) {
                return this.selectedOptions[0].label;
            }
            return `${this.selectedOptions.length} options selected`;
        }
        
        const selectedOption = this.options.find(option => option.value === this.value);
        return selectedOption ? selectedOption.label : '';
    }
    
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (this.disabled || this.isOpen) return;

        this.isOpen = true;
        this.ariaExpanded = 'true';

        // Start from the selected option, else the first one
        const visible = this.getVisibleOptions();
        const selectedIndex = visible.findIndex((option) => option.value === this.value);
        this.highlightedIndex = selectedIndex >= 0 ? selectedIndex : (visible.length ? 0 : -1);

        // Update dropdown arrow
        this.dropdownArrow.setStyle('transform', 'translateY(-50%) rotate(180deg)');

        // Show dropdown. The open root is a stacking context, so the list's z-index only
        // counts inside it; the root itself rises above later siblings while open.
        this.setStyle('zIndex', '1000');
        this.dropdownContainer.setStyle('display', 'block');
        this.dropdownContainer.setStyle('opacity', '1');
        this.dropdownContainer.setStyle('transform', 'translateY(0)');
        this.dropdownContainer.setStyle('z-index', '1000');

        // Render options
        this.renderOptions();
        this.updateVisualState();

        // Focus search input if searchable
        if (this.searchable && this.searchInput) {
            this.searchInput.focus();
        }

        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }

    // Visible options in display order (filtered while searching)
    getVisibleOptions() {
        return this.searchable ? this.filteredOptions : this.options;
    }

    navigateOptions(direction) {
        const visible = this.getVisibleOptions();
        if (visible.length === 0) return;
        let next = this.highlightedIndex;
        for (let step = 0; step < visible.length; step++) {
            next = (next + direction + visible.length) % visible.length;
            if (!visible[next].disabled) break;
        }
        this.highlightedIndex = next;
        this.renderOptions();
    }
    
    close() {
        if (!this.isOpen) return;
        
        this.isOpen = false;
        this.ariaExpanded = 'false';
        this.ariaActiveDescendant = null;

        // Reset dropdown arrow
        this.dropdownArrow.setStyle('transform', 'translateY(-50%) rotate(0deg)');

        // Hide dropdown
        this.dropdownContainer.setStyle('display', 'none');
        this.dropdownContainer.setStyle('opacity', '0');
        this.dropdownContainer.setStyle('transform', 'translateY(-8px)');
        this.dropdownContainer.setStyle('z-index', '0');
        this.setStyle('zIndex', '');

        // Clear search
        if (this.searchable) {
            this.searchTerm = '';
            if (this.searchInput && this.searchInput.element) {
                this.searchInput.element.value = '';
            }
            this.filterOptions();
        }

        this.updateVisualState();
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    filterOptions() {
        if (!this.searchable) {
            this.filteredOptions = [...this.options];
            return;
        }
        
        const searchTerm = this.searchTerm.toLowerCase();
        this.filteredOptions = this.options.filter(option => 
            option.label.toLowerCase().includes(searchTerm) ||
            option.value.toLowerCase().includes(searchTerm)
        );
    }
    
    renderOptions() {
        this.optionsList.clearChildren();
        
        const optionsToRender = this.getVisibleOptions();

        optionsToRender.forEach((option, index) => {
            const optionElement = document.createElement('li');
            const highlighted = index === this.highlightedIndex;
            optionElement.id = `${this.id}-option-${index}`;
            optionElement.setAttribute('role', 'option');
            optionElement.setAttribute('aria-selected', String(this.isOptionSelected(option)));
            if (option.disabled) optionElement.setAttribute('aria-disabled', 'true');
            if (highlighted) this.ariaActiveDescendant = optionElement.id;
            optionElement.textContent = option.label;
            optionElement.style.cssText = (
                'padding: 10px 12px;' +
                'color: ' + tokens.css('colors.text.primary') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'list-style: none;' +
                'background: ' + this.optionBackground(option, highlighted) + ';' +
                'border-radius: 12px;' +
                'margin: 4px 6px;'
            );
            
            optionElement.addEventListener('click', () => {
                this.selectOption(option);
            });
            
            optionElement.addEventListener('mouseenter', () => {
                optionElement.style.background = this.optionBackground(option, true);
            });
            
            optionElement.addEventListener('mouseleave', () => {
                optionElement.style.background = this.optionBackground(option, false);
            });
            
            this.optionsList.appendElement(optionElement);
        });
    }
    
    /** An option row's fill: the tone's soft tint when selected, a stronger one under the pointer or keyboard. */
    optionBackground(option, highlighted) {
        const c = this.toneColors();
        if (this.isOptionSelected(option)) return highlighted ? c.softActive : c.soft;
        return highlighted ? c.soft : 'transparent';
    }

    isOptionSelected(option) {
        if (this.multiple) {
            return this.selectedOptions.some(selected => selected.value === option.value);
        }
        return this.value === option.value;
    }
    
    selectOption(option) {
        if (this.multiple) {
            const index = this.selectedOptions.findIndex(selected => selected.value === option.value);
            if (index >= 0) {
                this.selectedOptions.splice(index, 1);
            } else {
                this.selectedOptions.push(option);
            }
        } else {
            this.selectedOptions = [option];
        }
        
        this.value = option.value;
        this.updateDisplayValue();

        if (!this.multiple) {
            this.close();
        }
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                value: this.value,
                selectedOptions: [...this.selectedOptions]
            }
        });
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    updateDisplayValue() {
        if (this.selectValue) {
            const display = this.getDisplayValue();
            this.selectValue.textContent = display || this.placeholder;
            this.selectValue.setStyle('color', display ? this.getInputColor() : 'var(--text-secondary, #475569)');
        }
        if (this.clearButton && this.clearButton.element) {
            this.clearButton.element.style.display = this.clearable && this.value ? 'flex' : 'none';
        }
    }
    
    clear() {
        this.value = '';
        this.selectedOptions = [];
        this.updateDisplayValue();
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                value: '',
                selectedOptions: []
            }
        });
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    // Public methods
    setOptions(options) {
        this.options = options.map(option => ({
            value: option.value || '',
            label: option.label || '',
            disabled: option.disabled || false
        }));
        
        this.filteredOptions = [...this.options];
        this.selectedOptions = this.selectedOptions.filter(selected => 
            this.options.some(option => option.value === selected.value)
        );
        
        this.renderOptions();
        this.markDirty(DIRTY.CHILDREN | DIRTY.PAINT);
    }
    
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            this.selectedOptions = this.options.filter(option => 
                this.multiple ? this.selectedOptions.some(selected => selected.value === option.value) : option.value === value
            );
            this.updateDisplayValue();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.setStyle('cursor', disabled ? 'not-allowed' : 'pointer');
            this.setupStyles();
            this.buildSelect();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.updateVisualState();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildSelect();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? (this.id + '-description') : null;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setSearchable(searchable) {
        if (this.searchable !== searchable) {
            this.searchable = searchable;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMultiple(multiple) {
        if (this.multiple !== multiple) {
            this.multiple = multiple;
            this.ariaMultiSelectable = multiple;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setClearable(clearable) {
        if (this.clearable !== clearable) {
            this.clearable = clearable;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            const selectInput = this.querySelector(`#${this.id}-input`);
            if (selectInput && selectInput.element) {
                selectInput.element.dataset.required = String(required);
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newSelectId();
        const selectWidget = new Select(id, options);
        if (container) {
            container.appendChild(widgetRenderer.render(selectWidget));
        }
        return selectWidget;
    }
    
    static getDefaultOptions() {
        return {
            value: '',
            options: [],
            placeholder: 'Select an option',
            disabled: false,
            searchable: true
        };
    }
    
    static createSelect(id, options = {}) {
        return new Select(id, options);
    }
    
    static createPrimarySelect(id, options = {}) {
        return new Select(id, { variant: 'primary', ...options });
    }
    
    static createSuccessSelect(id, options = {}) {
        return new Select(id, { variant: 'success', ...options });
    }
    
    static createWarningSelect(id, options = {}) {
        return new Select(id, { variant: 'warning', ...options });
    }
    
    static createErrorSelect(id, options = {}) {
        return new Select(id, { variant: 'error', ...options });
    }
    
    static createSmallSelect(id, options = {}) {
        return new Select(id, { size: 'sm', ...options });
    }
    
    static createLargeSelect(id, options = {}) {
        return new Select(id, { size: 'lg', ...options });
    }
    
    static createXLargeSelect(id, options = {}) {
        return new Select(id, { size: 'xl', ...options });
    }
    
    static createMultiSelect(id, options = {}) {
        return new Select(id, { multiple: true, ...options });
    }
    
    static createSearchableSelect(id, options = {}) {
        return new Select(id, { searchable: true, ...options });
    }
    
    static createClearableSelect(id, options = {}) {
        return new Select(id, { clearable: true, ...options });
    }
}

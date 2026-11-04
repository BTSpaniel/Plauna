// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Table - Data table widget for Plauna
 * Provides table functionality with sorting, filtering, and pagination
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, variantStyles, mix, TONES } from '../shared/appearance.js';

let _tableSequence = 0;

function _newTableId() {
    return `table-${Date.now()}-${++_tableSequence}`;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const KEY_OWNERS = '[role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [role="radiogroup"], [role="tablist"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="textbox"]';
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'image', 'color', 'file']);

/** Fields that use the arrow, Home/End and Page keys themselves (caret, options, value) keep them. */
function keepsNavigationKeys(element, scope) {
    if (element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
    if (element.tagName === 'INPUT') return !BUTTON_INPUTS.has(element.type);
    const owner = element.closest(KEY_OWNERS);
    return Boolean(owner && scope.contains(owner));
}

export class Table extends UINode {
    // Widget metadata
    static id = 'table';
    static name = 'Table';
    static category = 'dataviews';
    static icon = '📊';
    static description = 'Data table widget';
    static tags = ['dataviews', 'table', 'data'];
    static optionValues = { variant: ['default', ...TONES, 'secondary', 'error'], size: ['xs', 'sm', 'md', 'lg', 'xl'], striped: 'boolean', hoverable: 'boolean', bordered: 'boolean', selectable: 'boolean', pagination: 'boolean' };
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            columns: [],
            data: [],
            pagination: true,
            pageSize: 10
        };
    }
    
    static create(container, options = {}) {
        const instance = new Table(_newTableId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': {
                columns: [{ key: 'name', label: 'Asset' }, { key: 'type', label: 'Type' }, { key: 'size', label: 'Size', align: 'right' }],
                data: [
                    { name: 'player.glb', type: 'Model', size: '2.4 MB' },
                    { name: 'terrain.ktx2', type: 'Texture', size: '8.1 MB' },
                    { name: 'ambience.ogg', type: 'Audio', size: '1.2 MB' }
                ]
            },
            'Striped': {
                striped: true,
                columns: [{ key: 'pass', label: 'Pass' }, { key: 'ms', label: 'GPU ms', align: 'right' }],
                data: [{ pass: 'Shadows', ms: '0.42' }, { pass: 'Lighting', ms: '1.10' }, { pass: 'Post', ms: '0.35' }]
            }
        };
    }
    
    constructor(id = _newTableId(), options = {}) {
        super(id, 'table');
        // A composite widget: render a <div>, not the native <table> element
        this.tag = 'div';
        
        // Table-specific properties
        this.columns = options.columns || [];
        this.data = options.data || [];
        this.sortColumn = options.sortColumn || null;
        this.sortDirection = options.sortDirection || 'asc'; // asc, desc
        this.filterValue = options.filterValue || '';
        this.filterColumn = options.filterColumn || null;
        this.pagination = options.pagination !== false;
        this.currentPage = options.currentPage || 1;
        this.pageSize = options.pageSize || 10;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.striped = options.striped !== false;
        this.bordered = options.bordered || false;
        this.hoverable = options.hoverable !== false;
        this.selectable = options.selectable || false;
        this.loading = options.loading || false;
        this.empty = options.empty || 'No data available';
        
        // State management
        this.selectedRows = new Set();
        this.filteredData = [];
        // Row (index into filteredData) that holds the table's tab stop when selectable
        this.focusedRow = null;

        // Set accessibility
        this.role = 'table';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build table structure
        this.buildTable();
        
        // Initialize data
        if (options.data) {
            this.setData(options.data);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'block',
            width: '100%',
            overflow: 'auto',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs')
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm')
            },
            md: {
                fontSize: tokens.css('fontSizes.md')
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg')
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        // variant names the tone of the header and selection; a named tone also tints the text
        return { color: this.variant === 'default' ? tokens.css('colors.text.primary') : this.toneColors().text };
    }

    /** The selection's tone: default is primary, secondary is neutral, error is danger. */
    toneColors() {
        return toneOf(this.variant);
    }
    
    setupEventHandlers() {
        this.addEventListener('click', (e) => {
            if (this.selectable) {
                const row = e.domTarget.closest('tr');
                if (row && row.dataset.rowIndex) {
                    this.focusedRow = parseInt(row.dataset.rowIndex);
                    this.toggleRowSelection(this.focusedRow);
                }
            }
        });

        this.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowDown':
                case 'Home':
                case 'End':
                case 'PageUp':
                case 'PageDown':
                    this.handleKeyboardNavigation(e);
                    break;
                case ' ':
                case 'Enter': {
                    // On a focused row these pick it; on a control in a cell they stay the control's
                    const row = e.domTarget;
                    if (this.selectable && row?.parentNode === this.tbody && row.dataset.rowIndex) {
                        e.preventDefault();
                        this.focusedRow = parseInt(row.dataset.rowIndex);
                        this.toggleRowSelection(this.focusedRow);
                    }
                    break;
                }
            }
        });
    }

    /**
     * Arrow keys move to the previous or next row, Home and End to the first
     * and last row of the page, PageUp and PageDown a page of rows (pageSize),
     * turning the page when paginated. Focus lands on the same column's control
     * when the key came from one, else on the row (selectable tables) or the
     * row's first control. Keys a field uses itself are left to it.
     */
    handleKeyboardNavigation(e) {
        const target = e.domTarget;
        const row = target?.closest?.('tr[data-row-index]');
        if (e.defaultPrevented || !row || row.parentNode !== this.tbody) return;
        if (keepsNavigationKeys(target, this.tbody)) return;
        const from = parseInt(row.dataset.rowIndex);
        const last = this.filteredData.length - 1;
        const pageStart = this.pagination ? (this.currentPage - 1) * this.pageSize : 0;
        const pageEnd = this.pagination ? Math.min(last, pageStart + this.pageSize - 1) : last;
        const to = {
            ArrowUp: from - 1,
            ArrowDown: from + 1,
            Home: pageStart,
            End: pageEnd,
            PageUp: from - this.pageSize,
            PageDown: from + this.pageSize
        }[e.key];
        const column = target === row ? null : target.closest('td')?.cellIndex ?? null;
        if (this.focusRow(Math.max(0, Math.min(last, to)), column)) e.preventDefault();
    }

    /** Focus a row (index into the filtered data), or its control in `column`; turns the page to it. */
    focusRow(index, column = null) {
        if (this.pagination) {
            const page = Math.floor(index / this.pageSize) + 1;
            if (page !== this.currentPage) this.setPage(page);
        }
        return this.focusRenderedRow(index, column);
    }

    /** focusRow() for a row on the current page. */
    focusRenderedRow(index, column = null) {
        const row = this.tbody?.querySelector(`tr[data-row-index="${index}"]`);
        if (!row) return false;
        const target = (column !== null ? row.cells[column]?.querySelector(FOCUSABLE) : null)
            ?? (this.selectable ? row : row.querySelector(FOCUSABLE));
        if (!target) return false;
        this.focusedRow = index;
        this.updateRowTabStop();
        target.focus();
        return true;
    }

    /** A selectable table is one tab stop: the focused row, else the page's first row. */
    updateRowTabStop() {
        if (!this.tbody) return;
        const rows = [...this.tbody.querySelectorAll('tr[data-row-index]')];
        if (!this.selectable || rows.length === 0) {
            for (const row of rows) row.removeAttribute('tabindex');
            return;
        }
        const active = rows.find((row) => parseInt(row.dataset.rowIndex) === this.focusedRow) ?? rows[0];
        for (const row of rows) row.tabIndex = row === active ? 0 : -1;
    }
    
    // Table content is plain DOM hosted inside this widget's element
    createTableElement(tag, id) {
        const element = document.createElement(tag);
        element.id = id;
        return element;
    }
    
    buildTable() {
        this.clearChildren();
        
        // Create table element
        const table = this.createTableElement('table', `${this.id}-table`);
        Object.assign(table.style, {
            width: '100%',
            borderCollapse: this.bordered ? 'separate' : 'collapse',
            borderSpacing: this.bordered ? '0' : '0',
            fontSize: 'inherit'
        });
        
        // Create table header
        const thead = this.createTableElement('thead', `${this.id}-thead`);
        const headerRow = this.createTableElement('tr', `${this.id}-header-row`);
        Object.assign(headerRow.style, {
            backgroundColor: this.getHeaderBackgroundColor(),
            borderBottom: this.bordered ? `1px solid ${tokens.css('colors.border.medium')}` : 'none'
        });
        
        // Create header cells
        this._sortHeaders = [];
        this.columns.forEach((column, index) => {
            const th = this.createTableElement('th', `${this.id}-header-${index}`);
            th.textContent = column.label ?? column.key;
            th.style.cssText = (
                'padding: ' + tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg') + ';' +
                'text-align: ' + (column.align || 'left') + ';' +
                'font-weight: ' + tokens.css('fontWeights.semibold') + ';' +
                'color: ' + this.getHeaderTextColor() + ';' +
                'background: ' + this.getHeaderBackgroundColor() + ';' +
                'border-bottom: ' + (this.bordered ? '1px solid ' + tokens.css('colors.border.medium') : 'none') + ';' +
                'position: relative;' +
                'cursor: ' + (column.sortable ? 'pointer' : 'default') + ';' +
                'user-select: none;' +
                'transition: all 150ms ease;'
            );
            
            // Add sort indicator if sortable
            if (column.sortable) {
                // The label is a button inside the header, so Tab reaches it and
                // Enter or Space sorts; aria-sort on the header reports the order
                const sortButton = document.createElement('span');
                sortButton.setAttribute('role', 'button');
                sortButton.tabIndex = 0;
                sortButton.textContent = th.textContent;
                th.textContent = '';
                const sortIndicator = document.createElement('span');
                sortIndicator.setAttribute('aria-hidden', 'true');
                sortIndicator.style.cssText = (
                    'margin-left: 4px;' +
                    'font-size: 12px;' +
                    'opacity: 0.7;'
                );
                sortButton.appendChild(sortIndicator);
                th.appendChild(sortButton);
                this._sortHeaders.push({ key: column.key, th, sortIndicator });

                th.addEventListener('click', () => {
                    this.sortByColumn(column.key);
                });
                sortButton.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    this.sortByColumn(column.key);
                });
            }
            
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        this.updateSortHeaders();
        
        // Create table body
        const tbody = this.createTableElement('tbody', `${this.id}-tbody`);
        this.tbody = tbody;
        table.appendChild(tbody);
        
        // Create table footer if pagination is enabled
        if (this.pagination) {
            const tfoot = this.createTableElement('tfoot', `${this.id}-tfoot`);
            const footerRow = this.createTableElement('tr', `${this.id}-footer-row`);
            const footerCell = this.createTableElement('td', `${this.id}-footer-cell`);
            footerCell.setAttribute('colspan', this.columns.length);
            footerCell.style.cssText = (
                'padding: ' + tokens.css('spacing.md') + ';' +
                'text-align: center;' +
                'border-top: ' + (this.bordered ? '1px solid ' + tokens.css('colors.border.medium') : 'none') + ';'
            );
            
            // Create pagination controls
            const paginationContainer = document.createElement('div');
            paginationContainer.style.cssText = (
                'display: flex;' +
                'justify-content: center;' +
                'align-items: center;' +
                'gap: ' + tokens.css('spacing.md') + ';'
            );
            
            // Previous button
            const prevButton = document.createElement('button');
            prevButton.textContent = 'Previous';
            prevButton.style.cssText = (
                'padding: ' + tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md') + ';' +
                'background: ' + tokens.css('colors.background.primary') + ';' +
                'color: ' + tokens.css('colors.text.primary') + ';' +
                'border: 1px solid ' + tokens.css('colors.border.medium') + ';' +
                'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                'cursor: ' + (this.currentPage > 1 ? 'pointer' : 'not-allowed') + ';' +
                'opacity: ' + (this.currentPage > 1 ? '1' : '0.5') + ';' +
                'transition: all 150ms ease;'
            );
            
            prevButton.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.setPage(this.currentPage - 1);
                }
            });
            
            // Page info
            const pageInfo = document.createElement('span');
            pageInfo.textContent = `Page ${this.currentPage}`;
            pageInfo.style.cssText = (
                'font-size: ' + tokens.css('fontSizes.sm') + ';' +
                'color: ' + tokens.css('colors.text.secondary') + ';'
            );
            
            // Next button
            const nextButton = document.createElement('button');
            nextButton.textContent = 'Next';
            nextButton.style.cssText = (
                'padding: ' + tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md') + ';' +
                'background: ' + tokens.css('colors.background.primary') + ';' +
                'color: ' + tokens.css('colors.text.primary') + ';' +
                'border: 1px solid ' + tokens.css('colors.border.medium') + ';' +
                'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                'cursor: ' + (this.hasNextPage() ? 'pointer' : 'not-allowed') + ';' +
                'opacity: ' + (this.hasNextPage() ? '1' : '0.5') + ';' +
                'transition: all 150ms ease;'
            );
            
            nextButton.addEventListener('click', () => {
                if (this.hasNextPage()) {
                    this.setPage(this.currentPage + 1);
                }
            });
            
            this._pager = { prevButton, nextButton, pageInfo };
            paginationContainer.appendChild(prevButton);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextButton);
            
            footerCell.appendChild(paginationContainer);
            footerRow.appendChild(footerCell);
            tfoot.appendChild(footerRow);
            table.appendChild(tfoot);
        }
        
        this.appendElement(table);
        this.table = table;
        
        // Render initial data
        this.renderData();
    }
    
    getHeaderBackgroundColor() {
        if (this.variant === 'default') return tokens.css('colors.background.secondary');
        return variantStyles('surface', this.toneColors().name).backgroundColor;
    }
    
    getHeaderTextColor() {
        return this.variant === 'default' ? tokens.css('colors.text.primary') : this.toneColors().text;
    }
    
    getRowBackgroundColor(rowIndex) {
        if (this.selectedRows.has(rowIndex)) {
            return mix(this.toneColors().base, 14, tokens.css('colors.background.primary'));
        }
        
        if (this.striped && rowIndex % 2 === 1) {
            return tokens.css('colors.background.secondary');
        }
        
        return tokens.css('colors.background.primary');
    }
    
    renderData() {
        if (!this.tbody) return;

        // Rebuilding the rows drops the focus inside them; note where it was to put it back
        const active = this.tbody.getRootNode().activeElement;
        const activeRow = active && this.tbody.contains(active) ? active.closest('tr[data-row-index]') : null;
        const refocus = activeRow && {
            index: parseInt(activeRow.dataset.rowIndex),
            column: active === activeRow ? null : active.closest('td')?.cellIndex ?? null
        };

        this.tbody.innerHTML = '';
        
        if (this.loading) {
            // Show loading state
            const loadingRow = this.createTableElement('tr', `${this.id}-loading-row`);
            const loadingCell = this.createTableElement('td', `${this.id}-loading-cell`);
            loadingCell.setAttribute('colspan', this.columns.length);
            loadingCell.style.cssText = (
                'padding: ' + tokens.css('spacing.lg') + ';' +
                'text-align: center;' +
                'color: ' + tokens.css('colors.text.secondary') + ';'
            );
            loadingCell.textContent = 'Loading...';
            loadingRow.appendChild(loadingCell);
            this.tbody.appendChild(loadingRow);
            return;
        }
        
        const dataToRender = this.getPaginatedData();
        
        if (dataToRender.length === 0) {
            // Show empty state
            const emptyRow = this.createTableElement('tr', `${this.id}-empty-row`);
            const emptyCell = this.createTableElement('td', `${this.id}-empty-cell`);
            emptyCell.setAttribute('colspan', this.columns.length);
            emptyCell.style.cssText = (
                'padding: ' + tokens.css('spacing.lg') + ';' +
                'text-align: center;' +
                'color: ' + tokens.css('colors.text.secondary') + ';'
            );
            emptyCell.textContent = this.empty;
            emptyRow.appendChild(emptyCell);
            this.tbody.appendChild(emptyRow);
            return;
        }
        
        // Render data rows
        dataToRender.forEach((row, index) => {
            const actualIndex = this.getActualRowIndex(index);
            const tr = this.createTableElement('tr', `${this.id}-row-${actualIndex}`);
            tr.dataset.rowIndex = actualIndex.toString();
            
            // Row styling
            tr.style.cssText = (
                'background: ' + this.getRowBackgroundColor(actualIndex) + ';' +
                'transition: all 150ms ease;'
            );
            
            if (this.hoverable) {
                tr.addEventListener('mouseenter', () => {
                    tr.style.background = tokens.css('colors.background.tertiary');
                });
                
                tr.addEventListener('mouseleave', () => {
                    tr.style.background = this.getRowBackgroundColor(actualIndex);
                });
            }
            
            // Create cells
            this.columns.forEach((column, colIndex) => {
                const td = this.createTableElement('td', `${this.id}-cell-${actualIndex}-${colIndex}`);
                // A column may render its own cell content, such as a control
                const content = typeof column.render === 'function' ? column.render(row, actualIndex) : null;
                if (content instanceof Node) td.appendChild(content);
                else td.textContent = this.formatCellValue(row[column.key], column);
                td.style.cssText = (
                    'padding: ' + tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg') + ';' +
                    'text-align: ' + (column.align || 'left') + ';' +
                    'border-bottom: ' + (this.bordered ? '1px solid ' + tokens.css('colors.border.light') : 'none') + ';' +
                    'color: ' + tokens.css('colors.text.primary') + ';'
                );
                
                tr.appendChild(td);
            });
            
            this.tbody.appendChild(tr);
        });

        this.updatePagination();
        this.updateRowTabStop();
        if (refocus) this.focusRenderedRow(refocus.index, refocus.column);
    }
    
    formatCellValue(value, column) {
        if (column.formatter && typeof column.formatter === 'function') {
            return column.formatter(value);
        }
        
        if (value === null || value === undefined) {
            return '';
        }
        
        return String(value);
    }
    
    getActualRowIndex(displayIndex) {
        if (this.pagination) {
            return (this.currentPage - 1) * this.pageSize + displayIndex;
        }
        return displayIndex;
    }
    
    getPaginatedData() {
        if (!this.pagination) {
            return this.filteredData;
        }
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        return this.filteredData.slice(startIndex, endIndex);
    }
    
    getTotalPages() {
        return Math.ceil(this.filteredData.length / this.pageSize);
    }
    
    hasNextPage() {
        return this.currentPage < this.getTotalPages();
    }
    
    updatePagination() {
        if (!this.pagination) return;
        
        // Update pagination controls
        const { prevButton, nextButton, pageInfo } = this._pager ?? {};
        
        if (prevButton) {
            prevButton.style.opacity = this.currentPage > 1 ? '1' : '0.5';
            prevButton.style.cursor = this.currentPage > 1 ? 'pointer' : 'not-allowed';
        }
        
        if (nextButton) {
            nextButton.style.opacity = this.hasNextPage() ? '1' : '0.5';
            nextButton.style.cursor = this.hasNextPage() ? 'pointer' : 'not-allowed';
        }
        
        if (pageInfo) {
            pageInfo.textContent = `Page ${this.currentPage} of ${this.getTotalPages()}`;
        }
    }
    
    // Public methods
    setData(data) {
        this.data = data || [];
        this.applyFilter();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setColumns(columns) {
        this.columns = columns || [];
        this.buildTable();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    sortByColumn(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }

        this.sortRows();
        this.updateSortHeaders();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'sort',
            bubbles: true,
            detail: {
                column,
                direction: this.sortDirection
            }
        });
    }
    
    /** Order the filtered rows by the sort column; new data and filters keep the order. */
    sortRows() {
        const column = this.sortColumn;
        if (!column) return;
        this.filteredData.sort((a, b) => {
            const aValue = a[column];
            const bValue = b[column];

            if (aValue < bValue) {
                return this.sortDirection === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return this.sortDirection === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    /** The sorted header reports aria-sort and shows its arrow; the others show neither. */
    updateSortHeaders() {
        for (const { key, th, sortIndicator } of this._sortHeaders ?? []) {
            const sorted = this.sortColumn === key;
            if (sorted) th.setAttribute('aria-sort', this.sortDirection === 'asc' ? 'ascending' : 'descending');
            else th.removeAttribute('aria-sort');
            sortIndicator.textContent = sorted ? (this.sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
        }
    }

    setFilter(filterValue, filterColumn = null) {
        this.filterValue = filterValue;
        this.filterColumn = filterColumn;
        this.applyFilter();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    applyFilter() {
        const filterColumn = this.filterColumn || this.columns[0]?.key;
        if (!this.filterValue || !filterColumn) {
            this.filteredData = [...this.data];
        } else {
            this.filteredData = this.data.filter(row => {
                const value = String(row[filterColumn] || '').toLowerCase();
                return value.includes(this.filterValue.toLowerCase());
            });
        }
        this.sortRows();
    }
    
    setPage(page) {
        const totalPages = this.getTotalPages();
        if (page < 1 || page > totalPages) {
            return;
        }
        
        this.currentPage = page;
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'pageChange',
            bubbles: true,
            detail: {
                page: this.currentPage,
                totalPages
            }
        });
    }
    
    toggleRowSelection(rowIndex) {
        if (this.selectedRows.has(rowIndex)) {
            this.selectedRows.delete(rowIndex);
        } else {
            this.selectedRows.add(rowIndex);
        }
        
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionChange',
            bubbles: true,
            detail: {
                selectedRows: Array.from(this.selectedRows),
                data: this.selectedRows.size > 0 ? 
                    this.data.filter((_, index) => this.selectedRows.has(index)) : []
            }
        });
    }
    
    clearSelection() {
        this.selectedRows.clear();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setLoading(loading) {
        this.loading = loading;
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildTable();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildTable();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setStriped(striped) {
        if (this.striped !== striped) {
            this.striped = striped;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBordered(bordered) {
        if (this.bordered !== bordered) {
            this.bordered = bordered;
            this.buildTable();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHoverable(hoverable) {
        if (this.hoverable !== hoverable) {
            this.hoverable = hoverable;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSelectable(selectable) {
        if (this.selectable !== selectable) {
            this.selectable = selectable;
            this.clearSelection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPagination(pagination) {
        if (this.pagination !== pagination) {
            this.pagination = pagination;
            this.buildTable();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPageSize(pageSize) {
        if (this.pageSize !== pageSize) {
            this.pageSize = pageSize;
            this.currentPage = 1;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setEmpty(empty) {
        if (this.empty !== empty) {
            this.empty = empty;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static createTable(id, options = {}) {
        return new Table(id, options);
    }
    
    static createPrimaryTable(id, options = {}) {
        return new Table(id, { variant: 'primary', ...options });
    }
    
    static createSuccessTable(id, options = {}) {
        return new Table(id, { variant: 'success', ...options });
    }
    
    static createWarningTable(id, options = {}) {
        return new Table(id, { variant: 'warning', ...options });
    }
    
    static createErrorTable(id, options = {}) {
        return new Table(id, { variant: 'error', ...options });
    }
    
    static createSmallTable(id, options = {}) {
        return new Table(id, { size: 'sm', ...options });
    }
    
    static createLargeTable(id, options = {}) {
        return new Table(id, { size: 'lg', ...options });
    }
    
    static createXLargeTable(id, options = {}) {
        return new Table(id, { size: 'xl', ...options });
    }
    
    static createStripedTable(id, options = {}) {
        return new Table(id, { striped: true, ...options });
    }
    
    static createBorderedTable(id, options = {}) {
        return new Table(id, { bordered: true, ...options });
    }
    
    static createSelectableTable(id, options = {}) {
        return new Table(id, { selectable: true, ...options });
    }
    
    static createSortableTable(id, options = {}) {
        const sortableColumns = (options.columns || []).map(col => ({
            ...col,
            sortable: true
        }));
        return new Table(id, { columns: sortableColumns, ...options });
    }
    
    static createFilterableTable(id, options = {}) {
        return new Table(id, { filterable: true, ...options });
    }
}

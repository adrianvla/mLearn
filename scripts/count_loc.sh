#!/bin/bash

# Script to count lines of code in specific directories and files
# File types: .js, .html, .css, .py
# Directories: languages, modules, pages, scripts
# Individual files: server.py, main.js
# Excluding: pages/lib

echo "=================================="
echo "Lines of Code Counter"
echo "=================================="
echo

# Function to count lines in a directory
count_lines_in_dir() {
    local dir=$1
    local exclude_pattern=$2
    
    if [ ! -d "$dir" ]; then
        echo "Directory $dir not found, skipping..."
        return
    fi
    
    echo "Counting in directory: $dir"
    
    # Build find command with exclusions
    if [ -n "$exclude_pattern" ]; then
        find_cmd="find \"$dir\" -type f \( -name \"*.js\" -o -name \"*.html\" -o -name \"*.css\" -o -name \"*.py\" \) ! -path \"$exclude_pattern\""
    else
        find_cmd="find \"$dir\" -type f \( -name \"*.js\" -o -name \"*.html\" -o -name \"*.css\" -o -name \"*.py\" \)"
    fi
    
    # Get files and count lines
    files=$(eval $find_cmd)
    
    if [ -z "$files" ]; then
        echo "  No matching files found"
        echo
        return
    fi
    
    total_lines=0
    file_count=0
    
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            lines=$(wc -l < "$file" 2>/dev/null || echo 0)
            echo "  $file: $lines lines"
            total_lines=$((total_lines + lines))
            file_count=$((file_count + 1))
        fi
    done <<< "$files"
    
    echo "  ──────────────────────────────────"
    echo "  Subtotal for $dir: $total_lines lines in $file_count files"
    echo
    
    # Return the total (using global variable since bash functions can't return large numbers)
    dir_total=$total_lines
}

# Function to count lines in individual files
count_lines_in_file() {
    local file=$1
    
    if [ ! -f "$file" ]; then
        echo "File $file not found, skipping..."
        return
    fi
    
    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
    echo "Individual file: $file: $lines lines"
    
    # Return the total (using global variable)
    file_total=$lines
}

# Initialize grand total
grand_total=0

# Count lines in directories
echo "DIRECTORY ANALYSIS:"
echo "==================="

directories=("../languages" "../modules" "../pages" "../scripts")

for dir in "${directories[@]}"; do
    if [ "$dir" = "../pages" ]; then
        # Exclude pages/lib
        count_lines_in_dir "$dir" "*/pages/lib/*"
    else
        count_lines_in_dir "$dir" ""
    fi
    grand_total=$((grand_total + dir_total))
done

echo
echo "INDIVIDUAL FILES:"
echo "================="

# Count individual files
individual_files=("../server.py" "../main.js")

for file in "${individual_files[@]}"; do
    count_lines_in_file "$file"
    grand_total=$((grand_total + file_total))
done

echo
echo "=================================="
echo "SUMMARY"
echo "=================================="
echo "Total lines of code: $grand_total"
echo

# Show breakdown by file type
echo "BREAKDOWN BY FILE TYPE:"
echo "======================"

# Count by file type across all included locations
js_total=0
html_total=0
css_total=0
py_total=0

# Count in directories (excluding pages/lib)
for dir in "${directories[@]}"; do
    if [ -d "$dir" ]; then
        if [ "$dir" = "../pages" ]; then
            js_files=$(find "$dir" -name "*.js" ! -path "*/pages/lib/*" 2>/dev/null)
            html_files=$(find "$dir" -name "*.html" ! -path "*/pages/lib/*" 2>/dev/null)
            css_files=$(find "$dir" -name "*.css" ! -path "*/pages/lib/*" 2>/dev/null)
            py_files=$(find "$dir" -name "*.py" ! -path "*/pages/lib/*" 2>/dev/null)
        else
            js_files=$(find "$dir" -name "*.js" 2>/dev/null)
            html_files=$(find "$dir" -name "*.html" 2>/dev/null)
            css_files=$(find "$dir" -name "*.css" 2>/dev/null)
            py_files=$(find "$dir" -name "*.py" 2>/dev/null)
        fi
        
        # Count JavaScript files
        if [ -n "$js_files" ]; then
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
                    js_total=$((js_total + lines))
                fi
            done <<< "$js_files"
        fi
        
        # Count HTML files
        if [ -n "$html_files" ]; then
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
                    html_total=$((html_total + lines))
                fi
            done <<< "$html_files"
        fi
        
        # Count CSS files
        if [ -n "$css_files" ]; then
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
                    css_total=$((css_total + lines))
                fi
            done <<< "$css_files"
        fi
        
        # Count Python files
        if [ -n "$py_files" ]; then
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
                    py_total=$((py_total + lines))
                fi
            done <<< "$py_files"
        fi
    fi
done

# Add individual files
if [ -f "../main.js" ]; then
    lines=$(wc -l < "../main.js" 2>/dev/null || echo 0)
    js_total=$((js_total + lines))
fi

if [ -f "../server.py" ]; then
    lines=$(wc -l < "../server.py" 2>/dev/null || echo 0)
    py_total=$((py_total + lines))
fi

echo "JavaScript (.js): $js_total lines"
echo "HTML (.html): $html_total lines"
echo "CSS (.css): $css_total lines"
echo "Python (.py): $py_total lines"
echo "──────────────────────────────────"
echo "Total: $grand_total lines"
package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
)

type TocItem struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	PageNumber int    `json:"pageNumber"`
	Level      int    `json:"level"`
}

type BookMetadata struct {
	TotalPages int
	TOCJSON    string
	Items      []TocItem
}

// ExtractPDFMetadata parses a local PDF file to extract total pages and Table of Contents (Bookmarks).
func ExtractPDFMetadata(filePath string) (*BookMetadata, error) {
	meta := &BookMetadata{
		TotalPages: 0,
		TOCJSON:    "[]",
		Items:      []TocItem{},
	}

	f, err := os.Open(filePath)
	if err != nil {
		return meta, fmt.Errorf("open pdf file: %w", err)
	}
	defer f.Close()

	// 1. Extract total page count
	pageCount, err := api.PageCount(f, nil)
	if err == nil && pageCount > 0 {
		meta.TotalPages = pageCount
	}

	// Rewind file reader for bookmark extraction
	if _, err := f.Seek(0, 0); err != nil {
		return meta, nil
	}

	// 2. Extract bookmarks (outline tree)
	bms, err := api.Bookmarks(f, nil)
	if err != nil || len(bms) == 0 {
		return meta, nil
	}

	var items []TocItem
	var walk func(list []pdfcpu.Bookmark, level int)
	walk = func(list []pdfcpu.Bookmark, level int) {
		for _, bm := range list {
			page := bm.PageFrom
			if page < 1 {
				page = 1
			}
			title := strings.TrimSpace(bm.Title)
			if title == "" {
				title = "Chương"
			}

			items = append(items, TocItem{
				ID:         fmt.Sprintf("%s-%d-%d", title, page, len(items)),
				Title:      title,
				PageNumber: page,
				Level:      level,
			})

			if len(bm.Kids) > 0 {
				walk(bm.Kids, level+1)
			}
		}
	}

	walk(bms, 0)

	meta.Items = items
	if len(items) > 0 {
		if data, err := json.Marshal(items); err == nil {
			meta.TOCJSON = string(data)
		}
	}

	return meta, nil
}

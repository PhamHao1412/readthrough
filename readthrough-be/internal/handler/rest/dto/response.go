package dto

import (
	"net/http"
	"readthrough-be/pkg/pointer"
)

const (
	defaultSuccessTitle             = "success"
	defaultFailedTitle              = "failed"
	defaultInternalServerErrorTitle = "internal server error"
)

type Response struct {
	Succeeded bool     `json:"succeeded"`
	Title     string   `json:"title"`
	Message   string   `json:"message"`
	Data      any      `json:"data"`
	SttCode   int      `json:"status_code"`
	Errors    []string `json:"errors"`
	ErrCode   *string  `json:"error_code"`
	Total     int64    `json:"total_items,omitempty"`
}

func ResponseOK[T any](obj T) Response {
	return ResponseOKWithTitle(obj, defaultSuccessTitle)
}

func ResponseOKWithTitle[T any](obj T, title string) Response {
	return Response{
		Succeeded: true,
		Title:     title,
		Message:   title,
		Data:      obj,
		SttCode:   http.StatusOK,
	}
}

func ResponseBadRequest(err error) Response {
	return Response{
		Succeeded: false,
		Title:     defaultFailedTitle,
		Message:   err.Error(),
		SttCode:   http.StatusBadRequest,
	}
}

func ResponseBadRequestWithTitle(err error, title string) Response {
	return Response{
		Succeeded: false,
		Title:     title,
		Message:   err.Error(),
		SttCode:   http.StatusBadRequest,
	}
}

func ResponseForbidden(err error) Response {
	return Response{
		Succeeded: false,
		Errors:    []string{err.Error()},
		ErrCode:   pointer.To(err.Error()),
		Title:     defaultFailedTitle,
		Message:   defaultFailedTitle,
		SttCode:   http.StatusForbidden,
	}
}

func ResponseUnauthorized(err error) Response {
	return Response{
		Succeeded: false,
		Errors:    []string{err.Error()},
		ErrCode:   pointer.To(err.Error()),
		Title:     defaultFailedTitle,
		Message:   defaultFailedTitle,
		SttCode:   http.StatusUnauthorized,
	}
}

func ResponseNotFound(err error) Response {
	return Response{
		Succeeded: false,
		Errors:    []string{err.Error()},
		ErrCode:   pointer.To(err.Error()),
		Title:     defaultFailedTitle,
		Message:   err.Error(),
		SttCode:   http.StatusNotFound,
	}
}

func (r Response) WithMessage(message string) Response {
	r.Message = message
	return r
}

func (r Response) Status(status int) Response {
	r.SttCode = status
	return r
}

func (r Response) TotalItem(total int64) Response {
	r.Total = total
	return r
}

func (r Response) Error() string {
	return r.Message
}

func (r Response) StatusCode() int {
	return r.SttCode
}

func (r Response) ErrorCode() string {
	return pointer.From(r.ErrCode)
}

func ResponseError(err error, status int) Response {
	return ResponseErrWithTitle(err, status)
}

func ResponseErrWithTitle(err error, status int) Response {
	if status == http.StatusInternalServerError {
		return ResponseInternalServerError(err)
	}
	return Response{
		Succeeded: false,
		Errors:    nil,
		ErrCode:   pointer.To(err.Error()),
		Title:     defaultFailedTitle,
		Message:   err.Error(),
		SttCode:   status,
	}
}

func ResponseInternalServerError(err error) Response {
	return Response{
		Succeeded: false,
		Errors:    []string{defaultInternalServerErrorTitle},
		ErrCode:   pointer.To(defaultInternalServerErrorTitle),
		Title:     defaultFailedTitle,
		Message:   defaultInternalServerErrorTitle,
		SttCode:   http.StatusInternalServerError,
	}
}

// H is a shorthand for map[string]interface{} to represent a generic JSON object.
type H map[string]interface{}

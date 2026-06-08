package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Storage implements the Storage interface using Cloudflare R2 via the S3 API.
type R2Storage struct {
	client     *s3.Client
	bucketName string
}

// NewR2Storage creates a new R2Storage instance.
func NewR2Storage(accessKey, secretKey, accountID, bucketName string) (*R2Storage, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID))
		o.Region = "auto"
	})

	return &R2Storage{
		client:     client,
		bucketName: bucketName,
	}, nil
}

// Upload transfers a file to Cloudflare R2.
func (s *R2Storage) Upload(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error) {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucketName),
		Key:           aws.String(key),
		Body:          r,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// Download retrieves a file stream from Cloudflare R2.
func (s *R2Storage) Download(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, 0, "", err
	}

	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}

	var contentType string
	if out.ContentType != nil {
		contentType = *out.ContentType
	}

	return out.Body, size, contentType, nil
}

// Delete removes a file from Cloudflare R2.
func (s *R2Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucketName),
		Key:    aws.String(key),
	})
	return err
}

// GetPresignedURL generates a pre-signed URL from Cloudflare R2 valid for 15 minutes.
func (s *R2Storage) GetPresignedURL(ctx context.Context, key string) (string, bool, error) {
	presignClient := s3.NewPresignClient(s.client)
	req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucketName),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = 15 * time.Minute
	})
	if err != nil {
		return "", false, err
	}
	return req.URL, true, nil
}

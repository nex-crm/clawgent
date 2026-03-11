# SOC 2 CC6.1 / CC7.2 — S3 bucket versioning for data integrity and recovery

resource "aws_s3_bucket_versioning" "deploy_bucket" {
  bucket = var.s3_deploy_bucket

  versioning_configuration {
    status = "Enabled"
  }
}

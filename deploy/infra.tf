# Clawgent — AWS infrastructure owned by this repository
#
# Apply in the nex-production account (361769601293).
# Backend: configure to match your main infra state backend, or add a
# separate workspace/key so this state is fully isolated.
#
# Resources that pre-exist in other Terraform state (EC2 instance, OIDC
# provider, clawgent-instance-role) are referenced via data sources only —
# this file never writes to them.
#
# First-time apply: resources were created manually; import blocks below
# bring them under Terraform management without recreating them.
#
# Usage:
#   terraform -chdir=deploy init
#   terraform -chdir=deploy plan
#   terraform -chdir=deploy apply

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # TODO: configure a remote backend so this state is shared and doesn't
  # conflict with local runs. Example (S3):
  #
  # backend "s3" {
  #   bucket = "<your-tf-state-bucket>"
  #   key    = "clawgent/deploy/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = "us-east-1"
}

# ---------------------------------------------------------------------------
# Data sources — read-only references to resources managed elsewhere
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# clawgent-instance-role is managed in the main infra Terraform.
# We reference it here only to grant it bucket access via a bucket policy,
# so we never write an inline policy onto an externally-managed role.
data "aws_iam_role" "instance" {
  name = "clawgent-instance-role"
}

# ---------------------------------------------------------------------------
# S3 — deploy artifact staging bucket
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "deploy" {
  bucket = "clawgent-deploy-prod"

  tags = {
    Name    = "clawgent-deploy-prod"
    Project = "clawgent"
  }
}

# Grant the EC2 instance role read access via bucket policy rather than
# touching the role itself (which is owned by the main infra Terraform).
resource "aws_s3_bucket_policy" "deploy_instance_read" {
  bucket = aws_s3_bucket.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowClawgentInstanceRead"
      Effect = "Allow"
      Principal = {
        AWS = data.aws_iam_role.instance.arn
      }
      Action   = ["s3:GetObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.deploy.arn,
        "${aws_s3_bucket.deploy.arn}/*",
      ]
    }]
  })
}

# ---------------------------------------------------------------------------
# IAM — GitHub Actions OIDC role (scoped to this repo only)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "github_actions" {
  name        = "clawgent-github-actions-role"
  description = "GitHub Actions OIDC role for clawgent CD pipeline"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:nex-crm/clawgent:*"
        }
      }
    }]
  })

  max_session_duration = 3600

  tags = {
    Name    = "clawgent-github-actions-role"
    Project = "clawgent"
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "clawgent-deploy-policy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMSendCommand"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ec2:us-east-1:${data.aws_caller_identity.current.account_id}:instance/i-077cb08a20b586e7d",
          "arn:aws:ssm:us-east-1::document/AWS-RunShellScript",
        ]
      },
      {
        Sid      = "SSMGetInvocation"
        Effect   = "Allow"
        Action   = "ssm:GetCommandInvocation"
        Resource = "*"
      },
      {
        Sid    = "S3DeployBucket"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.deploy.arn,
          "${aws_s3_bucket.deploy.arn}/*",
        ]
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Import blocks — bring manually-created resources under Terraform management
# without recreating them (requires Terraform >= 1.5)
# ---------------------------------------------------------------------------

import {
  to = aws_s3_bucket.deploy
  id = "clawgent-deploy-prod"
}

import {
  to = aws_iam_role.github_actions
  id = "clawgent-github-actions-role"
}

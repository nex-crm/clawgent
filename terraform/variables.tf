variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "s3_deploy_bucket" {
  description = "Name of the S3 deployment bucket"
  type        = string
}

variable "ec2_instance_id" {
  description = "EC2 instance ID to monitor"
  type        = string
}

variable "cpu_alarm_threshold" {
  description = "CPU utilization percentage threshold for alarm"
  type        = number
  default     = 80
}

variable "cpu_alarm_evaluation_periods" {
  description = "Number of periods to evaluate before triggering alarm"
  type        = number
  default     = 3
}

variable "cpu_alarm_period_seconds" {
  description = "Length of each evaluation period in seconds"
  type        = number
  default     = 300
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications (optional)"
  type        = string
  default     = ""
}

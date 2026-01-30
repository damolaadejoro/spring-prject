# Spring Boot Observability on AWS ECS (CDK)

This project demonstrates a **vendor-agnostic observability stack** for a Spring Boot application running on **AWS ECS Fargate**, using **AWS CDK (TypeScript)**, **OpenTelemetry**, **Amazon Managed Prometheus**, and **Grafana**.

It is designed as a **proof of concept (PoC)** that follows best practices for cloud-native observability and infrastructure as code.

---

## 🏗️ Architecture Overview

The stack provisions the following components:

- **Spring Boot 2.2 Application**
  - Runs on **ECS Fargate**
  - Exposes health and metrics endpoints
  - `/actuator/health`
  - `/actuator/prometheus`

- **Application Load Balancer (ALB)**
  - Routes traffic to ECS tasks
  - Performs health checks using Spring Boot actuator

- **Amazon Managed Prometheus (AMP)**
  - Stores application metrics
  - Scraped from `/actuator/prometheus`

- **Grafana**
  - Visualizes metrics from AMP
  - Deployed on EC2
  - Accessible via public endpoint

- **AWS CDK (TypeScript)**
  - Infrastructure defined as code
  - Reproducible and version-controlled

---

## 📁 Project Structure

---

## 🚀 Prerequisites

Make sure you have the following installed:

- **Node.js** (LTS recommended)
- **AWS CLI**
- **AWS CDK v2**
- **Docker**
- **Java 11+**
- **Maven**
- An AWS account with sufficient permissions

Verify versions:

```bash
node -v
aws --version
cdk --version
docker --version
mvn -v

aws configure needed

npm install
cdk deploy


import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

@Injectable()
export class HttpClientService {
  create(baseURL?: string, defaults?: AxiosRequestConfig): AxiosInstance {
    return axios.create({
      baseURL,
      timeout: 30_000,
      ...defaults,
    });
  }
}

import axios from 'axios';

export class LocationNotFoundError extends Error {
}

export interface Location {
    name: string;
    lat: string;
    lng: string;
}

export class KakaoAPI {
    private axiosInstance = axios.create({
        headers: {
            authorization: `KakaoAK ${this.key}`,
        },
    });

    constructor(private key: string) { }

    async searchLocation(query: string): Promise<Location> {
        const resp = await this.axiosInstance.get(
            'https://dapi.kakao.com/v2/local/search/address.json',
            {
                params: {
                    query,
                },
            },
        );
        const documents = resp.data.documents;
        if (documents.length === 0) {
            throw new LocationNotFoundError();
        }
        const document = documents[0];

        const name = document.address_name;
        const lat = document.y;
        const lng = document.x;
        return {
            name,
            lat,
            lng,
        };
    }
}

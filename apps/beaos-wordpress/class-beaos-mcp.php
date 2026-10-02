<?php
/**
 * El cliente del MCP de BeAOS: JSON-RPC 2.0 sobre `POST`, sin SSE y sin sesión.
 *
 * Todo el protocolo vive en `beaos-aos-pure.php` (el sobre, la lectura de la respuesta, el motivo de un
 * status HTTP, el `Retry-After`). Acá sólo está lo que necesita WordPress: `wp_remote_post`, el header
 * `Authorization` y los tiempos de espera. Es a propósito: así el protocolo se prueba con `php` a secas.
 *
 * El token viaja **sólo** en el header. Nunca en el cuerpo, nunca en un log, nunca impreso.
 *
 * El MCP es la única puerta de BeAOS que acepta un token **por producto** (`agent_api_tokens`): su
 * `/api/v1/*` valida sólo contra `ADMIN_API_KEYS`, la llave maestra compartida. Por eso el plugin hace
 * todo por acá — el asistente y la sincronización del kit — y nunca pide una llave maestra.
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'BeAOS_MCP' ) ) {

	class BeAOS_MCP {

		/** @var string El token del producto. Nunca sale de esta clase. */
		private $token;

		/** @var string El endpoint del MCP. */
		private $endpoint;

		/** @var int Segundos de espera por request. */
		private $timeout;

		/** @var int El `id` del JSON-RPC. Correlativo, como pide el protocolo. */
		private $id = 0;

		/** @var string El motivo del último fallo, en castellano, listo para mostrar. */
		public $error = '';

		/** @var int El `code` del último error de protocolo, o 0. */
		public $code = 0;

		/** @var int Los segundos que pidió el servidor esperar (un 429), o 0. */
		public $retry_after = 0;

		public function __construct( $token, $endpoint = '', $timeout = BEAOS_AOS_TIMEOUT ) {
			$this->token    = trim( (string) $token );
			$endpoint       = trim( (string) $endpoint );
			$this->endpoint = '' !== $endpoint ? $endpoint : BEAOS_AOS_MCP;
			$this->timeout  = max( 1, (int) $timeout );
		}

		/** El endpoint que se va a usar, ya resuelto. */
		public function endpoint() {
			return $this->endpoint;
		}

		/**
		 * La verificación más barata de que un token entra: `tools/list` no toca la base, no escribe
		 * nada y no gasta una generación. Un `401` es token; un `200` con los 27 tools es "entra".
		 */
		public function ping() {
			$this->reset();
			$this->id++;
			$read = $this->send( beaos_aos_rpc( $this->id, 'tools/list' ) );
			if ( $read['ok'] && is_array( $read['result'] ) && isset( $read['result']['tools'] ) && is_array( $read['result']['tools'] ) ) {
				$read['tools'] = count( $read['result']['tools'] );
			}
			return $read;
		}

		/**
		 * Un `tools/call`. Devuelve la lectura de `beaos_aos_rpc_read()`; en `data` va el
		 * `structuredContent`, que es donde están las respuestas que **no** son errores pero dicen que
		 * no (`ok: false`, `published: false`, `found: false`).
		 */
		public function call( $tool, array $args = array() ) {
			$this->reset();
			$this->id++;
			return $this->send( beaos_aos_rpc_tool( $this->id, $tool, $args ) );
		}

		private function reset() {
			$this->error       = '';
			$this->code        = 0;
			$this->retry_after = 0;
		}

		/**
		 * El POST y nada más: interpretar la respuesta es de `beaos_aos_rpc_read()`.
		 *
		 * `timeout` acá no es cosmético: el asistente espera al MCP con una persona mirando la pantalla,
		 * y la sincronización del kit corre en el cron.
		 */
		private function send( array $payload ) {
			if ( '' === $this->token ) {
				return $this->fail( 'Falta el token de BeAOS: sin credencial no hay a quién preguntarle.' );
			}
			$body = wp_json_encode( $payload );
			if ( ! is_string( $body ) ) {
				return $this->fail( 'No se pudo serializar el pedido JSON-RPC.' );
			}

			$response = wp_remote_post(
				$this->endpoint,
				array(
					'timeout' => $this->timeout,
					'headers' => array(
						'content-type'  => 'application/json',
						'accept'        => 'application/json',
						// La única credencial aceptada por el MCP, además de `x-api-key`.
						'authorization' => 'Bearer ' . $this->token,
					),
					'body'    => $body,
				)
			);

			if ( is_wp_error( $response ) ) {
				return $this->fail( $response->get_error_message() );
			}

			$status = (int) wp_remote_retrieve_response_code( $response );
			$raw    = (string) wp_remote_retrieve_body( $response );

			// Un 0 **no es un status**: es que no hubo respuesta, que es lo que devuelve `wp_remote_post`
			// cuando el pedido no llega. Sin esta rama, el cuerpo vacío caía en el chequeo de JSON y el
			// error decía "puede haber un proxy o un WAF reescribiéndola": manda a buscar el problema al
			// lugar equivocado, porque no hay proxy ni respuesta.
			if ( 0 === $status ) {
				return $this->fail( 'No hubo respuesta del MCP: no se pudo llegar al servidor (DNS, TLS o tiempo de espera agotado).' );
			}

			// Una notificación responde 202 y sin cuerpo. El plugin nunca manda una (siempre lleva `id`),
			// así que verlo acá es una anomalía, no un caso a manejar en silencio.
			if ( 202 === $status ) {
				return $this->fail( 'El MCP trató el pedido como una notificación (202 sin cuerpo), y no lo era.' );
			}
			if ( $status >= 400 ) {
				$this->retry_after = beaos_aos_retry_after( wp_remote_retrieve_header( $response, 'retry-after' ) );
				return $this->fail( beaos_aos_http_error( $status, $raw, $this->retry_after ) );
			}

			$decoded = json_decode( $raw, true );
			if ( null === $decoded && 'null' !== trim( $raw ) ) {
				return $this->fail( 'La respuesta del MCP no es JSON: puede haber un proxy o un WAF reescribiéndola.' );
			}

			$read = beaos_aos_rpc_read( $decoded );
			if ( ! $read['ok'] && 'protocol' === $read['kind'] ) {
				$this->code  = (int) $read['code'];
				$this->error = (string) $read['error'];
			}
			return $read;
		}

		/** El fallo, en la misma forma que una lectura buena: el llamador no tiene dos caminos. */
		private function fail( $message ) {
			$this->error = (string) $message;
			return beaos_aos_rpc_result( false, 'transport', $this->code, $this->error );
		}
	}
}
